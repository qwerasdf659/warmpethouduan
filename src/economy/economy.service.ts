import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Ledger } from '../entities/ledger.entity';
import { Wallet } from '../entities/wallet.entity';

/** 积分池。两池物理隔离，接口层禁止互转。 */
export type WalletPool = 'game' | 'marketing';

/** 变动原因白名单（落 varchar，不用 pg enum：加原因不必改表结构）。 */
export const LEDGER_REASONS = [
  'interact', // 互动照顾产出
  'offline', // 离线收益
  'race', // 赛跑奖励
  'daily', // 签到 / 每日任务
  'dex', // 图鉴解锁奖励
  'ad', // 看广告奖励
  'purchase', // 购买装扮 / 家具（扣）
  'boost', // 加速 / 体力恢复（扣）
  'exchange', // 兑换中心（扣）
  'admin_grant', // 后台手动发放
  'admin_deduct', // 后台手动扣减
  'compensation', // 补偿
] as const;
export type LedgerReason = (typeof LEDGER_REASONS)[number];

export interface WalletView {
  gameCoin: number;
  marketingPoint: number;
}

export interface LedgerView {
  id: string;
  pool: WalletPool;
  delta: number;
  balanceAfter: number;
  bizId: string;
  reason: string;
  refId: string | null;
  createdAt: string;
}

export interface ApplyInput {
  userId: string;
  pool: WalletPool;
  /** 正数发放、负数扣减；禁止 0 */
  delta: number;
  /** 幂等键（客户端 UUID 或服务端拼的稳定串） */
  bizId: string;
  reason: LedgerReason;
  refId?: string | null;
}

export interface ApplyResult {
  wallet: WalletView;
  entry: LedgerView;
  /** true = 该 (bizId, pool) 之前已记账，本次为幂等回放，未二次变动余额 */
  duplicated: boolean;
}

const POOL_COLUMN: Record<WalletPool, string> = {
  game: 'game_coin',
  marketing: 'marketing_point',
};

interface WalletRow {
  game_coin: string;
  marketing_point: string;
}

/**
 * 经济域唯一记账入口。所有发放/扣减必须经此，禁止业务代码直接改 wallet。
 *
 * 并发与幂等**不依赖 Redis 锁**，而是靠数据库：
 *  - 余额变动用 `UPDATE ... SET col = col + $delta WHERE col + $delta >= 0` 单语句原子完成，
 *    天然免竞态，且「余额不足」表现为影响 0 行；
 *  - 重复提交由 `uq_ledger_user_biz_pool` 唯一索引拦截，事务回滚后走幂等回放。
 *
 * 这样设计的关键收益：调用方（如持有 `pet:{userId}` 锁的宠物域）可以安全地调用本服务，
 * 不会因为再抢一把锁而自死锁——Redis 锁不可重入。
 */
@Injectable()
export class EconomyService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    @InjectRepository(Ledger) private readonly ledgers: Repository<Ledger>,
  ) {}

  /** 读钱包（不存在则按 0 建行）。 */
  async getWallet(userId: string): Promise<WalletView> {
    await this.ensureWallet(this.dataSource.manager, userId);
    const w = await this.wallets.findOne({ where: { userId } });
    if (!w) throw new InternalServerErrorException('钱包创建失败');
    return {
      gameCoin: this.num(w.gameCoin),
      marketingPoint: this.num(w.marketingPoint),
    };
  }

  /**
   * 记一笔账并同步余额。同一 (userId, bizId, pool) 重复调用只生效一次。
   *
   * 注意：单次调用只动**一个**池。需要同时动两池的场景目前不存在；
   * 真出现时应新增一个显式的多池事务方法，而不是连调两次本方法（那样不是原子的）。
   */
  async apply(input: ApplyInput): Promise<ApplyResult> {
    const { userId, pool, delta, bizId, reason, refId = null } = input;

    const column = POOL_COLUMN[pool];
    if (!column) throw new BadRequestException('未知积分池');
    if (!Number.isSafeInteger(delta) || delta === 0) {
      throw new BadRequestException('delta 必须为非零安全整数');
    }
    if (!bizId) throw new BadRequestException('缺少幂等参数 bizId');

    try {
      return await this.dataSource.transaction(async (m) => {
        await this.ensureWallet(m, userId);

        // 单语句完成「校验 + 变更」，并发下无需锁；余额不足 → 影响 0 行
        const rows = this.rowsOf<WalletRow>(
          await m.query(
            `UPDATE "wallet"
                SET "${column}" = "${column}" + $2, "updated_at" = now()
              WHERE "user_id" = $1 AND "${column}" + $2 >= 0
          RETURNING "game_coin", "marketing_point"`,
            [userId, delta],
          ),
        );

        if (rows.length === 0) {
          throw new BadRequestException('余额不足');
        }

        const wallet: WalletView = {
          gameCoin: this.num(rows[0].game_coin),
          marketingPoint: this.num(rows[0].marketing_point),
        };
        const balanceAfter =
          pool === 'game' ? wallet.gameCoin : wallet.marketingPoint;

        // 唯一索引冲突 → 抛 23505 → 整个事务回滚（余额变更一并撤销）→ 外层走回放
        const inserted = this.rowsOf<{ id: string; created_at: Date }>(
          await m.query(
            `INSERT INTO "ledger"
               ("user_id","pool","delta","balance_after","biz_id","reason","ref_id")
             VALUES ($1,$2,$3,$4,$5,$6,$7)
          RETURNING "id","created_at"`,
            [userId, pool, delta, balanceAfter, bizId, reason, refId],
          ),
        );

        return {
          wallet,
          entry: {
            id: String(inserted[0].id),
            pool,
            delta,
            balanceAfter,
            bizId,
            reason,
            refId,
            createdAt: new Date(inserted[0].created_at).toISOString(),
          },
          duplicated: false,
        };
      });
    } catch (e) {
      if (this.isDuplicateLedger(e)) {
        return this.replay(userId, pool, bizId);
      }
      throw e;
    }
  }

  /** 流水分页（倒序）。可按池筛选。 */
  async listLedger(
    userId: string,
    opts: { page: number; pageSize: number; pool?: WalletPool },
  ): Promise<{ list: LedgerView[]; total: number }> {
    const [rows, total] = await this.ledgers.findAndCount({
      where: opts.pool ? { userId, pool: opts.pool } : { userId },
      order: { id: 'DESC' },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
    });
    return { list: rows.map((r) => this.toEntryView(r)), total };
  }

  /**
   * 后台全局流水分页（倒序）。可按玩家 / 池 / 原因筛选。
   * 出参附带 userId，便于后台按玩家对账。
   */
  async listGlobalLedger(opts: {
    page: number;
    pageSize: number;
    userId?: string;
    pool?: WalletPool;
    reason?: string;
  }): Promise<{ list: (LedgerView & { userId: string })[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (opts.userId) where.userId = opts.userId;
    if (opts.pool) where.pool = opts.pool;
    if (opts.reason) where.reason = opts.reason;

    const [rows, total] = await this.ledgers.findAndCount({
      where,
      order: { id: 'DESC' },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
    });
    return {
      list: rows.map((r) => ({ ...this.toEntryView(r), userId: r.userId })),
      total,
    };
  }

  /**
   * 后台人工发币/扣币。delta 正数发放、负数扣减；走同一 `apply` 记账入口，
   * 因此天然带 (userId,bizId,pool) 持久幂等与余额非负校验。
   */
  async adminGrant(input: {
    userId: string;
    pool: WalletPool;
    delta: number;
    bizId: string;
    reason?: string;
    refId?: string | null;
  }): Promise<ApplyResult> {
    const reason: LedgerReason =
      input.delta >= 0 ? 'admin_grant' : 'admin_deduct';
    return this.apply({
      userId: input.userId,
      pool: input.pool,
      delta: input.delta,
      bizId: input.bizId,
      reason,
      refId: input.refId ?? null,
    });
  }

  // ---------------------------------------------------------------- 内部

  private ensureWallet(m: EntityManager, userId: string): Promise<unknown> {
    return m.query(
      `INSERT INTO "wallet" ("user_id") VALUES ($1)
       ON CONFLICT ("user_id") DO NOTHING`,
      [userId],
    );
  }

  /** 幂等回放：返回原始账目 + 当前余额，明确标记 duplicated。 */
  private async replay(
    userId: string,
    pool: WalletPool,
    bizId: string,
  ): Promise<ApplyResult> {
    const entry = await this.ledgers.findOne({
      where: { userId, pool, bizId },
    });
    if (!entry) {
      // 唯一冲突却查不到原始记录，说明并发事务尚未提交；交由客户端重试
      throw new ConflictException('请求处理中，请勿重复提交');
    }
    return {
      wallet: await this.getWallet(userId),
      entry: this.toEntryView(entry),
      duplicated: true,
    };
  }

  /**
   * 归一化 `manager.query()` 的返回形状。TypeORM 在这里并不一致：
   *   SELECT / INSERT ... RETURNING → `rows[]`
   *   UPDATE / DELETE ... RETURNING → `[rows[], affectedCount]`
   * 直接按下标取值会在语句类型或 TypeORM 版本变化时静默取到错误的东西
   *（曾表现为余额读成 NaN），故统一在此收口。
   */
  private rowsOf<T>(raw: unknown): T[] {
    if (!Array.isArray(raw)) return [];
    if (
      raw.length === 2 &&
      Array.isArray(raw[0]) &&
      typeof raw[1] === 'number'
    ) {
      return raw[0] as T[];
    }
    return raw as T[];
  }

  private isDuplicateLedger(e: unknown): boolean {
    const err = e as { code?: string; driverError?: { code?: string } };
    const code = err?.code ?? err?.driverError?.code;
    return code === '23505';
  }

  private toEntryView(e: Ledger): LedgerView {
    return {
      id: e.id,
      pool: e.pool as WalletPool,
      delta: this.num(e.delta),
      balanceAfter: this.num(e.balanceAfter),
      bizId: e.bizId,
      reason: e.reason,
      refId: e.refId,
      createdAt: new Date(e.createdAt).toISOString(),
    };
  }

  /**
   * bigint(string) → number。金额存 bigint 是为了不吃浮点误差、量级留足，
   * 但出参用 number（前端直接算进度/够不够买，免 BigInt 解析）。
   * 2^53 ≈ 9.0e15，宠物游戏币量级远达不到；真越界宁可显式报错也不静默丢精度。
   */
  private num(v: string | number): number {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isSafeInteger(n)) {
      throw new InternalServerErrorException('账户金额超出安全整数范围');
    }
    return n;
  }
}
