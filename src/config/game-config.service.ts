import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type * as Joi from 'joi';
import { Repository } from 'typeorm';
import { LockService } from '../common/lock/lock.service';
import { GameConfig } from '../entities/game-config.entity';
import {
  CONFIG_KEYS,
  CONFIG_REGISTRY,
  configEntryOf,
  type ConfigKey,
  type ConfigShape,
} from './game-config.registry';

/**
 * 内存缓存有效期。后台写入会立即失效本进程缓存，所以 TTL 只用于兜住
 * 「多进程部署时别的 worker 改了配置」——当前 PM2 instances=1，实际不会触发。
 * 取 30s 是在「运营改完立刻见效」与「别把配置读成每请求一次 DB」之间折中。
 */
const CACHE_TTL_MS = 30_000;

/**
 * 玩法配置的唯一读取入口：DB 优先、代码常量兜底。
 *
 * 三条硬约束：
 *  1. **永不因配置问题抛错**。DB 挂了、行缺失、值非法，一律回退默认值并告警；
 *     配置是运营调参通道，不该成为玩法的新故障源。
 *  2. **加载时二次校验**。写入时已校验过，但历史脏数据、直连 SQL 改库都绕得过去，
 *     所以取值时按 schema 再验一遍，非法项**单独**回退（不影响同一次加载的其它 key）。
 *  3. **同一次请求内配置一致**。调用方取一次 `snapshot()` 往下传，
 *     避免一个请求内前后读到不同版本的配置。
 */
@Injectable()
export class GameConfigService implements OnApplicationBootstrap {
  private readonly logger = new Logger('GameConfig');

  /** 最近一次成功加载的快照。DB 不可用时的兜底来源，失效时**不清空**。 */
  private cache: { at: number; data: ConfigShape } | null = null;
  /** 被显式失效过，下次取值必须重新读库（哪怕 TTL 还没到） */
  private stale = false;
  /** 并发首次加载时只打一次 DB（防惊群） */
  private inflight: Promise<ConfigShape> | null = null;

  constructor(
    @InjectRepository(GameConfig)
    private readonly repo: Repository<GameConfig>,
    private readonly lock: LockService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.lock.withLock('game-config:bootstrap', () => this.seed(), {
        ttlMs: 30_000,
        retries: 3,
        retryDelayMs: 500,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`配置播种跳过/失败（已忽略，运行时走默认值）: ${msg}`);
    }
  }

  /** 全量配置快照（已校验）。调用方应取一次后往下传，保证请求内一致。 */
  async snapshot(): Promise<ConfigShape> {
    const fresh =
      !this.stale && this.cache && Date.now() - this.cache.at < CACHE_TTL_MS;
    if (fresh) return this.cache!.data;
    if (this.inflight) return this.inflight;

    const task = this.load();
    this.inflight = task;
    try {
      return await task;
    } finally {
      this.inflight = null;
    }
  }

  /** 单项取值。内部仍走整表快照，因为配置总量很小（约 20 项）。 */
  async get<K extends ConfigKey>(key: K): Promise<ConfigShape[K]> {
    return (await this.snapshot())[key];
  }

  /**
   * 标记缓存过期，让下次取值重新读库（后台写入/删除后调用）。
   *
   * 只置标记、不丢快照：否则「刚失效 + DB 恰好不可用」会让配置从运营设定值
   * 静默跌回代码默认值，奖励和上限会突变，比读到略旧的值危险得多。
   */
  invalidate(): void {
    this.stale = true;
  }

  /**
   * 校验待写入的值，返回**归一化后**的值（Joi 会把 "30" 这类字符串转成数字）。
   * 校验不通过时抛出，由调用方转成 400。
   */
  validate(key: string, value: unknown): unknown {
    const entry = configEntryOf(key);
    if (!entry) {
      throw new Error(
        `未注册的配置项 "${key}"。可用项：${CONFIG_KEYS.join(', ')}`,
      );
    }
    const result: Joi.ValidationResult<unknown> = entry.schema.validate(value, {
      abortEarly: false,
      convert: true,
    });
    if (result.error) {
      throw new Error(result.error.details.map((d) => d.message).join('; '));
    }
    return result.value;
  }

  /** 代码内置默认值（后台「恢复默认」与种子灌入共用）。 */
  defaultOf(key: string): unknown {
    return configEntryOf(key)?.default;
  }

  // ---------------------------------------------------------------- 内部

  private async load(): Promise<ConfigShape> {
    let rows: GameConfig[];
    try {
      rows = await this.repo.find();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 读不到 DB 时优先复用上一次的快照（哪怕已过期），比退回默认值更贴近现状
      if (this.cache) {
        this.logger.warn(`配置读取失败，沿用上一次快照: ${msg}`);
        return this.cache.data;
      }
      this.logger.warn(`配置读取失败，全部走默认值: ${msg}`);
      return this.buildDefaults();
    }

    const stored = new Map(rows.map((r) => [r.key, r.value]));
    const data: Record<string, unknown> = {};

    for (const key of CONFIG_KEYS) {
      const entry = CONFIG_REGISTRY[key];
      if (!stored.has(key)) {
        data[key] = entry.default;
        continue;
      }
      try {
        data[key] = this.validate(key, stored.get(key));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // 单项非法只影响该项：其余配置照常生效，避免一处填错全盘退回默认
        this.logger.error(`配置项 "${key}" 非法，已回退默认值: ${msg}`);
        data[key] = entry.default;
      }
    }

    const snapshot = data as ConfigShape;
    this.cache = { at: Date.now(), data: snapshot };
    this.stale = false;
    return snapshot;
  }

  private buildDefaults(): ConfigShape {
    const data: Record<string, unknown> = {};
    for (const key of CONFIG_KEYS) data[key] = CONFIG_REGISTRY[key].default;
    return data as ConfigShape;
  }

  /**
   * 把缺失的配置项按默认值补齐（幂等，不覆盖运营已改过的值）。
   * 目的：后台配置页开箱可见全部可调项，运营不必凭空猜 key。
   */
  private async seed(): Promise<void> {
    const existing = await this.repo.find({ select: { key: true } });
    const known = new Set(existing.map((r) => r.key));
    const missing = CONFIG_KEYS.filter((k) => !known.has(k));
    if (missing.length === 0) return;

    await this.repo.insert(
      missing.map((key) => ({
        key,
        description: CONFIG_REGISTRY[key].description,
        value: CONFIG_REGISTRY[key].default,
      })),
    );
    this.invalidate();
    this.logger.log(`配置播种完成，新增 ${missing.length} 项`);
  }
}
