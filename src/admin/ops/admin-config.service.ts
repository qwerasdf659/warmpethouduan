import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CONFIG_KEYS, configEntryOf } from '../../config/game-config.registry';
import { GameConfigService } from '../../config/game-config.service';
import { GameConfig } from '../../entities/game-config.entity';
import { UpsertConfigDto } from './dto/config.dto';

/** 列表项：在存储行之上补上「代码侧」信息，便于运营看出改了什么、能否恢复默认。 */
export interface ConfigListItem {
  key: string;
  description: string;
  value: unknown;
  updatedAt: Date;
  /** 是否为代码注册过的可调项（false 表示历史遗留 key，玩法不读它） */
  registered: boolean;
  /** 代码内置默认值（未注册项为 null） */
  default: unknown;
  /** 当前值是否已偏离默认值 */
  modified: boolean;
}

/**
 * 配置中心 CRUD。
 *
 * 与早期「任意 JSON 直存」的区别：写入必须通过注册表的 Joi schema 校验，
 * 且写完立刻失效 `GameConfigService` 缓存——否则运营在后台点了保存却发现
 * 游戏里没变化，只能靠重启，配置中心就白做了。
 */
@Injectable()
export class AdminConfigService {
  constructor(
    @InjectRepository(GameConfig)
    private readonly configs: Repository<GameConfig>,
    private readonly gameConfig: GameConfigService,
  ) {}

  async list(): Promise<{ list: ConfigListItem[] }> {
    const rows = await this.configs.find({ order: { key: 'ASC' } });
    return { list: rows.map((r) => this.toItem(r)) };
  }

  async get(key: string): Promise<ConfigListItem> {
    const row = await this.configs.findOne({ where: { key } });
    if (!row) throw new NotFoundException('配置项不存在');
    return this.toItem(row);
  }

  /**
   * 按 key upsert。只接受注册过的 key：允许写入任意 key 的话，运营打错一个字
   * 就会存出一条永远不生效的「幽灵配置」，且没有任何报错提示。
   */
  async upsert(
    key: string,
    dto: UpsertConfigDto,
  ): Promise<{ config: ConfigListItem }> {
    const entry = configEntryOf(key);
    if (!entry) {
      throw new BadRequestException(
        `未注册的配置项 "${key}"。可用项：${CONFIG_KEYS.join(', ')}`,
      );
    }

    let normalized: unknown;
    try {
      normalized = this.gameConfig.validate(key, dto.value);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(`配置值非法：${msg}`);
    }

    let row = await this.configs.findOne({ where: { key } });
    if (!row) {
      row = this.configs.create({
        key,
        value: normalized,
        description: dto.description ?? entry.description,
      });
    } else {
      row.value = normalized;
      if (dto.description !== undefined) row.description = dto.description;
    }
    const saved = await this.configs.save(row);
    this.gameConfig.invalidate();
    return { config: this.toItem(saved) };
  }

  /** 恢复某项为代码内置默认值（保留行，运营仍能在列表里看到并继续调）。 */
  async reset(key: string): Promise<{ config: ConfigListItem }> {
    const entry = configEntryOf(key);
    if (!entry) throw new BadRequestException(`未注册的配置项 "${key}"`);

    let row = await this.configs.findOne({ where: { key } });
    if (!row) {
      row = this.configs.create({ key, description: entry.description });
    }
    row.value = entry.default;
    const saved = await this.configs.save(row);
    this.gameConfig.invalidate();
    return { config: this.toItem(saved) };
  }

  /**
   * 删除配置行。注册项禁止删除——删掉只会让它从后台列表消失、运营再也调不到，
   * 而玩法照旧走代码默认值，是纯粹的误操作；要恢复默认请用 reset。
   * 仅允许清理历史遗留的未注册 key。
   */
  async remove(key: string): Promise<{ ok: true }> {
    if (configEntryOf(key)) {
      throw new BadRequestException(
        '该项由代码注册，不可删除；如需恢复默认值请调用 reset',
      );
    }
    const res = await this.configs.delete({ key });
    if (!res.affected) throw new NotFoundException('配置项不存在');
    this.gameConfig.invalidate();
    return { ok: true };
  }

  private toItem(row: GameConfig): ConfigListItem {
    const entry = configEntryOf(row.key);
    return {
      key: row.key,
      description: row.description,
      value: row.value,
      updatedAt: row.updatedAt,
      registered: !!entry,
      default: entry ? entry.default : null,
      modified: entry ? !deepEqual(row.value, entry.default) : false,
    };
  }
}

/**
 * 顺序无关的深比较。
 *
 * 不能用 `JSON.stringify(a) !== JSON.stringify(b)`：jsonb 存取会重排对象键，
 * 于是从未被改过的配置也会被判成「已改」（实测 21 项里误报 12 项）。
 * 「已改」标签和「恢复默认」按钮都依赖这个判断，误报会让它们彻底失去意义。
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    // 数组语义有序（如 pet.stages、race.tracks 的档位顺序），逐位比
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a !== 'object') return false;

  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  if (ak.length !== Object.keys(bo).length) return false;
  return ak.every((k) => Object.hasOwn(bo, k) && deepEqual(ao[k], bo[k]));
}
