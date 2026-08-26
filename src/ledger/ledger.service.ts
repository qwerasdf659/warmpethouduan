import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { rowsOf } from '../common/db/query-result';
import type { AssetKind } from '../entities/asset-def.entity';
import { AccountService } from './account.service';
import {
  AccountRef,
  BAN_EXEMPT_REASONS,
  BalanceView,
  EntryView,
  InstanceBurn,
  InstanceMove,
  Leg,
  LedgerReason,
  MintSpec,
  MintedInstance,
  PostInput,
  PostResult,
  TxnKind,
  isSystemRef,
  refKey,
} from './ledger.types';

/** 一条腿被规范化之后的形态（账户已解析为 id，delta 已补默认值）。 */
interface ResolvedLeg {
  accountId: string;
  assetCode: string;
  delta: number;
  frozenDelta: number;
}

interface AssetDefRow {
  code: string;
  kind: AssetKind;
  expire_days: number | null;
  trade_cooldown_hours: number;
}

interface LotRow {
  id: string;
  remaining: string;
  frozen: string;
}

/** 批次的两个桶。`none` = 离开本账户（发行进来 / 销毁出去）。 */
type LotBucket = 'remaining' | 'frozen';

/**
 * 账本唯一记账入口。所有资产变动必须经此，业务代码不得直接改 `asset_balance`
 * 或 `item_instance`。
 *
 * 三条并发与幂等的基本约定：
 *
 *  1. **余额变动用条件原子 UPDATE**（`WHERE available + $d >= 0`），单语句完成
 *     「校验 + 变更」，并发下无需行锁；余额不足表现为影响 0 行。不引入
 *     `SELECT FOR UPDATE`：那会让同一账户的写入排队，且与调用方已持有的
 *     Redis 锁叠加出复杂的等待关系。
 *  2. **多账户凭证在同一事务内按 `accountId` 升序更新**，杜绝交易双方互等的死锁。
 *  3. **本服务内部不获取 Redis 锁**：调用方可能已持 `pet:{userId}` 锁，
 *     Redis 锁不可重入，再抢一把就是自死锁。
 *
 * 幂等收敛到 `asset_txn.biz_id` 一处：唯一冲突（23505）→ 事务整体回滚 →
 * 回放原凭证并返回 `duplicated: true`。
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger('Ledger');

  /** `asset_def` 是低频变更的配置表，进程内缓存省掉记账路径上的一次查询。 */
  private readonly defCache = new Map<string, AssetDefRow>();

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly accounts: AccountService,
  ) {}

  /** 配置变更后由 `AssetCatalogService` 调用，避免缓存说谎。 */
  invalidateDefCache(): void {
    this.defCache.clear();
  }

  // ---------------------------------------------------------------- 记账

  /**
   * 过账。一次调用 N 条分录整体原子、整体幂等。
   *
   * 重复提交同一 `bizKey` 不会二次变动余额，返回原凭证且 `duplicated: true`。
   */
  async post(input: PostInput): Promise<PostResult> {
    const bizId = this.buildBizId(input);
    try {
      return await this.ds.transaction((m) => this.postWithin(m, input, bizId));
    } catch (e) {
      if (this.isDuplicateBizId(e))
        return this.replay(bizId, input.actorUserId);
      throw e;
    }
  }

  /**
   * 在调用方事务内过账，供需要「业务单据 + 记账」原子落库的场景使用
   * （如市场成交要同时改 `market_listing.status`）。
   *
   * 幂等冲突会把**调用方的整个事务**一起回滚，这是有意的：单据与账务必须同生共死。
   * 调用方应捕获并用 `isDuplicateBizId` + `replay` 处理。
   */
  async postWithin(
    m: EntityManager,
    input: PostInput,
    bizId = this.buildBizId(input),
  ): Promise<PostResult> {
    const legs = input.legs ?? [];
    const mints = input.mints ?? [];
    const moves = input.instanceMoves ?? [];
    const burns = input.instanceBurns ?? [];
    if (
      legs.length === 0 &&
      mints.length === 0 &&
      moves.length === 0 &&
      burns.length === 0
    ) {
      throw new BadRequestException('凭证至少要有一条分录或一次实例变动');
    }

    // 凭证头先插：幂等冲突在这里以最低代价暴露，不必先做完余额计算再回滚
    const txnId = await this.insertTxn(m, input, bizId);

    const resolved = await this.resolveLegs(m, legs);
    this.assertBalanced(input.kind, resolved, moves.length);
    await this.assertNotBanned(m, input.reason, legs, mints, moves, burns);

    // 升序更新账户，杜绝「A 等 B 的行、B 等 A 的行」
    resolved.sort(
      (a, b) =>
        Number(a.accountId) - Number(b.accountId) ||
        a.assetCode.localeCompare(b.assetCode),
    );

    const balances = new Map<string, Map<string, BalanceView>>();
    for (const leg of resolved) {
      const after = await this.applyLeg(m, txnId, leg);
      const perAccount =
        balances.get(leg.accountId) ?? new Map<string, BalanceView>();
      perAccount.set(leg.assetCode, after);
      balances.set(leg.accountId, perAccount);
    }

    const minted: MintedInstance[] = [];
    for (const spec of mints) {
      minted.push(await this.mintInstance(m, txnId, spec));
    }
    for (const move of moves) {
      await this.moveInstance(m, txnId, move);
    }
    for (const burn of burns) {
      await this.burnInstance(m, txnId, burn);
    }

    return {
      txnId,
      bizId,
      balances: await this.actorBalances(input.actorUserId, balances),
      minted,
      duplicated: false,
    };
  }

  /**
   * 冲正：按原凭证生成反向分录，写 `reversal_of`。
   *
   * 这是**唯一**的账务修复手段。刻意不提供「从流水重算余额」的工具：那类工具会
   * 忽略 `frozen` 与批次分桶，把带冻结的账户改错，修复工具本身成为故障源。
   */
  async reverse(
    txnId: string,
    bizKey: string,
    reason: LedgerReason = 'reversal',
  ): Promise<PostResult> {
    const original = rowsOf<{ id: string; kind: TxnKind; reason: string }>(
      await this.ds.query(
        `SELECT "id","kind","reason" FROM "asset_txn" WHERE "id" = $1`,
        [txnId],
      ),
    )[0];
    if (!original) throw new BadRequestException('原凭证不存在');

    const already = rowsOf<{ id: string }>(
      await this.ds.query(
        `SELECT "id" FROM "asset_txn" WHERE "reversal_of" = $1`,
        [txnId],
      ),
    );
    if (already.length > 0) {
      throw new BadRequestException('该凭证已冲正，不可重复冲正');
    }

    const entries = rowsOf<{
      account_id: string;
      asset_code: string;
      delta: string;
      frozen_delta: string;
    }>(
      await this.ds.query(
        `SELECT "account_id","asset_code","delta","frozen_delta"
           FROM "asset_entry" WHERE "txn_id" = $1`,
        [txnId],
      ),
    );
    const instEntries = rowsOf<{
      instance_id: string;
      account_id: string;
      delta: number;
    }>(
      await this.ds.query(
        `SELECT "instance_id","account_id","delta"
           FROM "item_instance_entry" WHERE "txn_id" = $1`,
        [txnId],
      ),
    );

    // 冲正的账户在原分录里已经是 id，不必再走 ref 解析
    const resolved: ResolvedLeg[] = entries.map((e) => ({
      accountId: String(e.account_id),
      assetCode: e.asset_code,
      delta: -Number(e.delta),
      frozenDelta: -Number(e.frozen_delta),
    }));

    // 实例：原凭证里 +1 的账户交回 −1 的账户（即把转移倒回去）
    const moves: { instanceId: string; fromId: string; toId: string }[] = [];
    const byInstance = new Map<string, { from?: string; to?: string }>();
    for (const e of instEntries) {
      const slot = byInstance.get(e.instance_id) ?? {};
      if (e.delta === 1) slot.to = String(e.account_id);
      else slot.from = String(e.account_id);
      byInstance.set(e.instance_id, slot);
    }
    for (const [instanceId, slot] of byInstance) {
      if (!slot.to || !slot.from) {
        // 铸造凭证（只有 +1，没有对手方）无法冲正：物品要销毁得走单独的回收流程，
        // 否则实例守恒（不变量 5）会被破坏
        throw new BadRequestException('铸造凭证不可冲正，请走系统回收');
      }
      moves.push({ instanceId, fromId: slot.to, toId: slot.from });
    }

    const bizId = `sys:reversal:${txnId}:${bizKey}`;
    try {
      const result = await this.ds.transaction(async (m) => {
        const newTxnId = await this.insertTxn(
          m,
          { kind: 'reversal', reason, refType: 'asset_txn', refId: txnId },
          bizId,
          txnId,
        );
        resolved.sort(
          (a, b) =>
            Number(a.accountId) - Number(b.accountId) ||
            a.assetCode.localeCompare(b.assetCode),
        );
        for (const leg of resolved) await this.applyLeg(m, newTxnId, leg);
        for (const mv of moves) {
          await this.moveInstanceById(
            m,
            newTxnId,
            mv.instanceId,
            mv.fromId,
            mv.toId,
            'held',
            false,
          );
        }
        return {
          txnId: newTxnId,
          bizId,
          balances: {},
          minted: [],
          duplicated: false,
        };
      });
      // 冲正会凭空反转已发生的余额，是账目上最敏感的一步，必须留痕供事后审计
      this.logger.warn(
        `冲正凭证 txn=${txnId}（原 kind=${original.kind} reason=${original.reason}）→ 新 txn=${result.txnId} reason=${reason}，涉及 ${resolved.length} 条分录 / ${moves.length} 次实例回退`,
      );
      return result;
    } catch (e) {
      if (this.isDuplicateBizId(e)) return this.replay(bizId);
      throw e;
    }
  }

  // ---------------------------------------------------------------- 读

  /** 玩家全部资产余额（assetCode -> 可用/冻结）。 */
  async balances(userId: string): Promise<Record<string, BalanceView>> {
    const accountId = await this.accounts.peek({ userId });
    if (!accountId) return {};
    const rows = rowsOf<{
      asset_code: string;
      available: string;
      frozen: string;
    }>(
      await this.ds.query(
        `SELECT "asset_code","available","frozen" FROM "asset_balance" WHERE "account_id" = $1`,
        [accountId],
      ),
    );
    const out: Record<string, BalanceView> = {};
    for (const r of rows) {
      out[r.asset_code] = {
        available: this.num(r.available),
        frozen: this.num(r.frozen),
      };
    }
    return out;
  }

  /** 玩家流水分页（倒序）。 */
  async history(
    userId: string,
    opts: { page: number; pageSize: number; assetCode?: string },
  ): Promise<{ list: EntryView[]; total: number }> {
    const accountId = await this.accounts.peek({ userId });
    if (!accountId) return { list: [], total: 0 };

    const params: unknown[] = [accountId];
    let where = `e."account_id" = $1`;
    if (opts.assetCode) {
      params.push(opts.assetCode);
      where += ` AND e."asset_code" = $${params.length}`;
    }

    const total = Number(
      rowsOf<{ c: string }>(
        await this.ds.query(
          `SELECT COUNT(*) AS c FROM "asset_entry" e WHERE ${where}`,
          params,
        ),
      )[0]?.c ?? 0,
    );
    params.push(opts.pageSize, (opts.page - 1) * opts.pageSize);
    const rows = rowsOf<EntryRow>(
      await this.ds.query(
        `SELECT e."id", e."txn_id", e."asset_code", e."delta", e."frozen_delta",
                e."balance_after", e."frozen_after", e."created_at",
                t."kind", t."reason", t."biz_id", t."ref_id"
           FROM "asset_entry" e JOIN "asset_txn" t ON t."id" = e."txn_id"
          WHERE ${where}
          ORDER BY e."created_at" DESC, e."id" DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      ),
    );
    return {
      list: rows.map((r) => this.toEntryView(r)),
      total,
    };
  }

  /** 后台全局流水分页（倒序），可按玩家 / 资产 / 原因筛选。 */
  async globalHistory(opts: {
    page: number;
    pageSize: number;
    userId?: string;
    assetCode?: string;
    reason?: string;
  }): Promise<{
    list: (EntryView & { userId: string | null })[];
    total: number;
  }> {
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (opts.userId) {
      params.push(opts.userId);
      clauses.push(`a."user_id" = $${params.length}`);
    }
    if (opts.assetCode) {
      params.push(opts.assetCode);
      clauses.push(`e."asset_code" = $${params.length}`);
    }
    if (opts.reason) {
      params.push(opts.reason);
      clauses.push(`t."reason" = $${params.length}`);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const total = Number(
      rowsOf<{ c: string }>(
        await this.ds.query(
          `SELECT COUNT(*) AS c
             FROM "asset_entry" e
             JOIN "asset_txn" t ON t."id" = e."txn_id"
             JOIN "account" a  ON a."id" = e."account_id"
           ${where}`,
          params,
        ),
      )[0]?.c ?? 0,
    );
    params.push(opts.pageSize, (opts.page - 1) * opts.pageSize);
    const rows = rowsOf<EntryRow & { user_id: string | null }>(
      await this.ds.query(
        `SELECT e."id", e."txn_id", e."asset_code", e."delta", e."frozen_delta",
                e."balance_after", e."frozen_after", e."created_at",
                t."kind", t."reason", t."biz_id", t."ref_id", a."user_id"
           FROM "asset_entry" e
           JOIN "asset_txn" t ON t."id" = e."txn_id"
           JOIN "account" a  ON a."id" = e."account_id"
         ${where}
          ORDER BY e."created_at" DESC, e."id" DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      ),
    );
    return {
      list: rows.map((r) => ({
        ...this.toEntryView(r),
        userId: r.user_id ? String(r.user_id) : null,
      })),
      total,
    };
  }

  // ---------------------------------------------------------------- 幂等

  isDuplicateBizId(e: unknown): boolean {
    const err = e as {
      code?: string;
      constraint?: string;
      driverError?: { code?: string; constraint?: string };
    };
    const code = err?.code ?? err?.driverError?.code;
    const constraint = err?.constraint ?? err?.driverError?.constraint;
    return code === '23505' && constraint === 'uq_asset_txn_biz_id';
  }

  /** 幂等回放：返回原凭证 + 当前余额，明确标记 duplicated。 */
  async replay(bizId: string, actorUserId?: string): Promise<PostResult> {
    const txn = rowsOf<{ id: string }>(
      await this.ds.query(`SELECT "id" FROM "asset_txn" WHERE "biz_id" = $1`, [
        bizId,
      ]),
    )[0];
    if (!txn) {
      // 唯一冲突却查不到原始凭证，说明并发事务尚未提交；交由客户端重试
      throw new ConflictException('请求处理中，请勿重复提交');
    }
    const txnId = String(txn.id);
    const minted = rowsOf<{
      id: string;
      asset_code: string;
      serial: number | null;
    }>(
      await this.ds.query(
        `SELECT "id","asset_code","serial" FROM "item_instance" WHERE "minted_txn_id" = $1`,
        [txnId],
      ),
    ).map((r) => ({
      instanceId: String(r.id),
      assetCode: r.asset_code,
      serial: r.serial,
    }));

    return {
      txnId,
      bizId,
      balances: actorUserId ? await this.balances(actorUserId) : {},
      minted,
      duplicated: true,
    };
  }

  /**
   * 幂等键前缀由本服务**强制拼接**，调用方无法绕过。
   *
   * `asset_txn.biz_id` 是全局唯一的，而旧 `ledger` 的幂等键带 `user_id`
   * （防不同玩家撞同一个客户端 UUID）。前缀就是那个 `user_id` 的替代物：
   * 少了它，两个玩家提交同样的客户端 UUID 会互相「幂等回放」掉对方的操作。
   */
  buildBizId(input: {
    scope?: PostInput['scope'];
    actorUserId?: string;
    bizKey: string;
  }): string {
    const key = (input.bizKey ?? '').trim();
    if (!key) throw new BadRequestException('缺少幂等参数 bizKey');

    const scope = input.scope ?? (input.actorUserId ? 'user' : 'sys');
    let bizId: string;
    if (scope === 'user') {
      if (!input.actorUserId) {
        throw new BadRequestException('玩家发起的凭证必须带 actorUserId');
      }
      bizId = `u${input.actorUserId}:${key}`;
    } else {
      bizId = `${scope}:${key}`;
    }

    if (bizId.length > 160) {
      throw new BadRequestException('幂等键过长');
    }
    return bizId;
  }

  // ---------------------------------------------------------------- 内部：凭证与分录

  private async insertTxn(
    m: EntityManager,
    input: {
      kind: TxnKind;
      reason: LedgerReason;
      refType?: string;
      refId?: string | null;
    },
    bizId: string,
    reversalOf?: string,
  ): Promise<string> {
    const rows = rowsOf<{ id: string }>(
      await m.query(
        `INSERT INTO "asset_txn" ("biz_id","kind","reason","ref_type","ref_id","reversal_of")
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING "id"`,
        [
          bizId,
          input.kind,
          input.reason,
          input.refType ?? null,
          input.refId ?? null,
          reversalOf ?? null,
        ],
      ),
    );
    return String(rows[0].id);
  }

  private async resolveLegs(
    m: EntityManager,
    legs: Leg[],
  ): Promise<ResolvedLeg[]> {
    const ids = await this.accounts.resolveMany(
      legs.map((l) => l.account),
      m,
    );
    return legs.map((l) => {
      const delta = l.delta ?? 0;
      const frozenDelta = l.frozenDelta ?? 0;
      if (!Number.isSafeInteger(delta) || !Number.isSafeInteger(frozenDelta)) {
        throw new BadRequestException('分录金额必须为安全整数');
      }
      if (delta === 0 && frozenDelta === 0) {
        throw new BadRequestException(
          '分录的 delta 与 frozenDelta 不能同时为 0',
        );
      }
      const accountId = ids.get(refKey(l.account));
      if (!accountId) {
        throw new InternalServerErrorException('账户解析失败');
      }
      return { accountId, assetCode: l.assetCode, delta, frozenDelta };
    });
  }

  /**
   * 凭证内平衡校验。
   *
   * 求和口径是 `delta + frozenDelta` 而**不是**只看 `delta`：竞价中标结算时买家出的
   * 是冻结中的钱（`frozenDelta = −1000`、`delta = 0`），卖家收到的是可用余额
   * （`delta = +950`）。只看 `delta` 会把这张完全平衡的凭证判成差 1000。
   * 「总价值守恒」才是要守的不变量，可用与冻结只是它的两个桶。
   */
  private assertBalanced(
    kind: TxnKind,
    legs: ResolvedLeg[],
    instanceMoveCount = 0,
  ): void {
    if (kind === 'transfer') {
      const byAsset = new Map<string, number>();
      for (const l of legs) {
        byAsset.set(
          l.assetCode,
          (byAsset.get(l.assetCode) ?? 0) + l.delta + l.frozenDelta,
        );
      }
      for (const [assetCode, sum] of byAsset) {
        if (sum !== 0) {
          throw new InternalServerErrorException(
            `转移凭证不平衡：资产 ${assetCode} 求和为 ${sum}，应为 0`,
          );
        }
      }
      // 「至少两条腿」的意图是「必须有对手方」。纯唯一物品的赠送没有数量分录，
      // 对手方体现在成对的 ±1 实例分录上，因此实例转移也算满足该条件。
      if (legs.length < 2 && instanceMoveCount === 0) {
        throw new InternalServerErrorException(
          '转移凭证至少需要两条分录或一次实例转移',
        );
      }
      return;
    }

    if (kind === 'freeze') {
      // 冻结是同一账户内可用↔冻结的搬移，总量不变
      for (const l of legs) {
        if (l.delta + l.frozenDelta !== 0) {
          throw new InternalServerErrorException(
            `冻结凭证不守恒：${l.assetCode} 的 delta+frozenDelta 应为 0`,
          );
        }
      }
    }
  }

  /**
   * 资金兜底：控制器的 `PlayerStatusGuard` 管准入，这里保证任何绕过路径
   * （内部服务调用、将来新增的控制器忘挂守卫）都动不了封禁账号的资产。
   */
  private async assertNotBanned(
    m: EntityManager,
    reason: LedgerReason,
    legs: Leg[],
    mints: MintSpec[],
    moves: InstanceMove[],
    burns: InstanceBurn[] = [],
  ): Promise<void> {
    if (BAN_EXEMPT_REASONS.has(reason)) return;

    const userIds = new Set<string>();
    const collect = (ref: AccountRef) => {
      if (!isSystemRef(ref)) userIds.add(ref.userId);
    };
    for (const l of legs) collect(l.account);
    for (const s of mints) collect(s.to);
    for (const mv of moves) {
      collect(mv.from);
      collect(mv.to);
    }
    for (const b of burns) collect(b.from);
    if (userIds.size === 0) return;

    const banned = rowsOf<{ id: string; banned_reason: string | null }>(
      await m.query(
        `SELECT "id","banned_reason" FROM "user"
          WHERE "id" = ANY($1::bigint[]) AND "status" = 'banned'`,
        [[...userIds]],
      ),
    );
    if (banned.length > 0) {
      // 记账兜底拦下了一次封禁账号的资产变动——要么守卫漏挂、要么内部调用绕过了准入，
      // 两种都值得排查，故按 reason 留痕
      this.logger.warn(
        `拦截封禁账号的资产操作：user=${banned[0].id} reason=${reason}`,
      );
      const note = banned[0].banned_reason;
      throw new ForbiddenException(
        note ? `账号已被封禁：${note}` : '账号已被封禁',
      );
    }
  }

  /** 更新余额 + 分摊批次 + 写分录。返回该账户该资产变更后的余额。 */
  private async applyLeg(
    m: EntityManager,
    txnId: string,
    leg: ResolvedLeg,
  ): Promise<BalanceView> {
    const def = await this.defOf(m, leg.assetCode);
    if (def.kind === 'unique') {
      throw new BadRequestException(
        `资产 ${leg.assetCode} 是唯一物品，只能通过实例转移变动，不能走数量分录`,
      );
    }

    await m.query(
      `INSERT INTO "asset_balance" ("account_id","asset_code") VALUES ($1,$2)
       ON CONFLICT ("account_id","asset_code") DO NOTHING`,
      [leg.accountId, leg.assetCode],
    );

    // 单语句完成「校验 + 变更」；余额不足 → 影响 0 行
    const updated = rowsOf<{ available: string; frozen: string }>(
      await m.query(
        `UPDATE "asset_balance"
            SET "available" = "available" + $3,
                "frozen"    = "frozen" + $4,
                "updated_at" = now()
          WHERE "account_id" = $1 AND "asset_code" = $2
            AND "available" + $3 >= 0 AND "frozen" + $4 >= 0
        RETURNING "available","frozen"`,
        [leg.accountId, leg.assetCode, leg.delta, leg.frozenDelta],
      ),
    );
    if (updated.length === 0) {
      throw new BadRequestException(
        leg.frozenDelta !== 0 ? '可冻结余额不足' : '余额不足',
      );
    }

    await this.applyLots(m, leg, def);

    const available = this.num(updated[0].available);
    const frozen = this.num(updated[0].frozen);
    await m.query(
      `INSERT INTO "asset_entry"
         ("txn_id","account_id","asset_code","delta","frozen_delta","balance_after","frozen_after")
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        txnId,
        leg.accountId,
        leg.assetCode,
        leg.delta,
        leg.frozenDelta,
        available,
        frozen,
      ],
    );
    return { available, frozen };
  }

  // ---------------------------------------------------------------- 内部：批次

  /**
   * 把一条分录的净变动落到批次上。
   *
   * `asset_balance` 是批次的聚合缓存，两者必须在同一事务内一起动，否则
   * 对账不变量 9（`SUM(lot.remaining) == balance.available`）立刻漂移。
   */
  private async applyLots(
    m: EntityManager,
    leg: ResolvedLeg,
    def: AssetDefRow,
  ): Promise<void> {
    const { delta, frozenDelta } = leg;

    // 发行：UPSERT 归并到同一到期日的批次
    if (delta > 0 && frozenDelta === 0) {
      await this.issueLot(m, leg, def, delta);
      return;
    }
    // 消耗：FIFO 跨批次扣减可用
    if (delta < 0 && frozenDelta === 0) {
      await this.takeFromLots(m, leg, -delta, 'remaining', null);
      return;
    }
    // 冻结：可用 → 冻结（总量不变）
    if (delta < 0 && frozenDelta === -delta) {
      await this.takeFromLots(m, leg, -delta, 'remaining', 'frozen');
      return;
    }
    // 解冻：冻结 → 可用
    if (delta > 0 && frozenDelta === -delta) {
      await this.takeFromLots(m, leg, delta, 'frozen', 'remaining');
      return;
    }
    // 冻结资金出账（竞价中标付款）：冻结直接离开本账户
    if (delta === 0 && frozenDelta < 0) {
      await this.takeFromLots(m, leg, -frozenDelta, 'frozen', null);
      return;
    }

    throw new BadRequestException(
      `不支持的分录形态：delta=${delta} frozenDelta=${frozenDelta}`,
    );
  }

  private async issueLot(
    m: EntityManager,
    leg: ResolvedLeg,
    def: AssetDefRow,
    amount: number,
  ): Promise<void> {
    // 到期日按**自然月末**截断再加 expire_days：使每玩家每月至多一行，
    // 而不是每天一行。归并粒度是「不启用过期的成本归零」的关键。
    await m.query(
      `INSERT INTO "asset_lot"
         ("account_id","asset_code","remaining","issued_total","expires_at")
       VALUES ($1,$2,$3,$3,
         CASE WHEN $4::int IS NULL THEN NULL
              ELSE date_trunc('month', now()) + interval '1 month' + ($4::int || ' days')::interval
         END)
       ON CONFLICT ("account_id","asset_code","expires_at")
       DO UPDATE SET "remaining"    = "asset_lot"."remaining"    + EXCLUDED."remaining",
                     "issued_total" = "asset_lot"."issued_total" + EXCLUDED."issued_total",
                     "updated_at"   = now()`,
      [leg.accountId, leg.assetCode, amount, def.expire_days],
    );
  }

  /**
   * 从批次里取出 `amount`，按 `expires_at NULLS LAST, id` 升序（FIFO：先扣最早到期的，
   * 永不过期的排最后）。`to = null` 表示离开本账户。
   *
   * 不用 `SELECT FOR UPDATE`：批次分摊用「读候选 → 条件 UPDATE → 不够则重读」的乐观
   * 循环。总量是否足够已由 `asset_balance` 的条件 UPDATE 先一步拦住，这里只负责分摊，
   * 所以循环必然收敛；重读的唯一成因是并发事务刚好动了同一批次。
   */
  private async takeFromLots(
    m: EntityManager,
    leg: ResolvedLeg,
    amount: number,
    from: LotBucket,
    to: LotBucket | null,
  ): Promise<void> {
    let left = amount;

    for (let round = 0; round < 20 && left > 0; round += 1) {
      const lots = rowsOf<LotRow>(
        await m.query(
          `SELECT "id","remaining","frozen" FROM "asset_lot"
            WHERE "account_id" = $1 AND "asset_code" = $2 AND "${from}" > 0
            ORDER BY "expires_at" NULLS LAST, "id"
            LIMIT 100`,
          [leg.accountId, leg.assetCode],
        ),
      );
      if (lots.length === 0) break;

      for (const lot of lots) {
        if (left <= 0) break;
        const inBucket = this.num(
          from === 'remaining' ? lot.remaining : lot.frozen,
        );
        const take = Math.min(left, inBucket);
        if (take <= 0) continue;

        const rDelta =
          (from === 'remaining' ? -take : 0) + (to === 'remaining' ? take : 0);
        const fDelta =
          (from === 'frozen' ? -take : 0) + (to === 'frozen' ? take : 0);

        const affected = rowsOf<{ id: string }>(
          await m.query(
            `UPDATE "asset_lot"
                SET "remaining" = "remaining" + $2,
                    "frozen"    = "frozen" + $3,
                    "updated_at" = now()
              WHERE "id" = $1 AND "remaining" + $2 >= 0 AND "frozen" + $3 >= 0
            RETURNING "id"`,
            [lot.id, rDelta, fDelta],
          ),
        );
        if (affected.length > 0) left -= take;
      }
    }

    if (left > 0) {
      throw new ConflictException('批次分摊失败，请稍后重试');
    }
  }

  // ---------------------------------------------------------------- 内部：唯一物品

  /**
   * 铸造一件唯一物品。限量资产的编号由原子自增语句分配，售罄表现为影响 0 行。
   */
  private async mintInstance(
    m: EntityManager,
    txnId: string,
    spec: MintSpec,
  ): Promise<MintedInstance> {
    const def = await this.defOf(m, spec.assetCode);
    if (def.kind !== 'unique') {
      throw new BadRequestException(
        `资产 ${spec.assetCode} 不是唯一物品，不能铸造实例`,
      );
    }
    const accountId = await this.accounts.resolve(spec.to, m);

    const bumped = rowsOf<{ minted_count: number; mint_limit: number | null }>(
      await m.query(
        `UPDATE "asset_def"
            SET "minted_count" = "minted_count" + 1, "updated_at" = now()
          WHERE "code" = $1 AND ("mint_limit" IS NULL OR "minted_count" < "mint_limit")
        RETURNING "minted_count","mint_limit"`,
        [spec.assetCode],
      ),
    );
    if (bumped.length === 0) {
      throw new BadRequestException('该限量物品已售罄');
    }
    // 不限量资产不落 serial：编号只有在有上限时才有「第 N/M 件」的含义
    const serial =
      bumped[0].mint_limit === null ? null : Number(bumped[0].minted_count);

    const inserted = rowsOf<{ id: string }>(
      await m.query(
        `INSERT INTO "item_instance"
           ("asset_code","owner_account_id","state","serial","tradable_after","minted_txn_id")
         VALUES ($1,$2,'held',$3, now() + ($4::int || ' hours')::interval, $5)
         RETURNING "id"`,
        [spec.assetCode, accountId, serial, def.trade_cooldown_hours, txnId],
      ),
    );
    const instanceId = String(inserted[0].id);

    await m.query(
      `INSERT INTO "item_instance_entry" ("txn_id","instance_id","account_id","delta")
       VALUES ($1,$2,$3,1)`,
      [txnId, instanceId, accountId],
    );
    return { instanceId, assetCode: spec.assetCode, serial };
  }

  private async moveInstance(
    m: EntityManager,
    txnId: string,
    move: InstanceMove,
  ): Promise<void> {
    const fromId = await this.accounts.resolve(move.from, m);
    const toId = await this.accounts.resolve(move.to, m);
    const toIsUser = !isSystemRef(move.to);
    const state = move.toState ?? (toIsUser ? 'held' : 'escrowed');
    await this.moveInstanceById(
      m,
      txnId,
      move.instanceId,
      fromId,
      toId,
      state,
      // 冷却默认只在「转到玩家手上」时重置：转入 ESCROW 是挂单的一部分，
      // 若也重置，撤单再挂单就能无限刷新冷却，冷却形同虚设。
      // 撤单会显式传 false —— 拿回自己的东西不该重新罚一次冷却。
      move.resetCooldown ?? toIsUser,
    );
  }

  /**
   * 销毁一件唯一物品：只写一条 `−1` 分录，实例落 `state='burned'` 终态。
   *
   * `owner_account_id` 保留最后一位持有者不改，这样对账不变量 6
   * （owner == 最后一条 +1 分录的账户）对销毁实例依然成立，无需为它开特例。
   * 代价是所有「谁持有什么」的查询都必须带 `state <> 'burned'` ——
   * `InventoryService` 已统一处理。
   */
  private async burnInstance(
    m: EntityManager,
    txnId: string,
    burn: InstanceBurn,
  ): Promise<void> {
    const fromId = await this.accounts.resolve(burn.from, m);
    const burned = rowsOf<{ id: string }>(
      await m.query(
        `UPDATE "item_instance" SET "state" = 'burned'
          WHERE "id" = $1 AND "owner_account_id" = $2 AND "state" = 'held'
        RETURNING "id"`,
        [burn.instanceId, fromId],
      ),
    );
    if (burned.length === 0) {
      throw new BadRequestException('物品不存在、不属于你或正在挂单中');
    }
    await m.query(
      `INSERT INTO "item_instance_entry" ("txn_id","instance_id","account_id","delta")
       VALUES ($1,$2,$3,-1)`,
      [txnId, burn.instanceId, fromId],
    );
  }

  private async moveInstanceById(
    m: EntityManager,
    txnId: string,
    instanceId: string,
    fromAccountId: string,
    toAccountId: string,
    state: string,
    resetCooldown: boolean,
  ): Promise<void> {
    if (fromAccountId === toAccountId) {
      throw new BadRequestException('实例转移的双方不能是同一账户');
    }

    // 冷却时长按实例所属资产取，因此先读一次实例（也顺带确认它存在）
    const found = rowsOf<{ asset_code: string }>(
      await m.query(
        `SELECT "asset_code" FROM "item_instance" WHERE "id" = $1`,
        [instanceId],
      ),
    );
    if (!found[0]) throw new BadRequestException('物品不存在');
    const cooldown = resetCooldown
      ? (await this.defOf(m, found[0].asset_code)).trade_cooldown_hours
      : null;

    const moved = rowsOf<{ id: string }>(
      await m.query(
        `UPDATE "item_instance"
            SET "owner_account_id" = $3,
                "state" = $4,
                "tradable_after" = CASE WHEN $5::int IS NULL THEN "tradable_after"
                  ELSE now() + ($5::int || ' hours')::interval END
          WHERE "id" = $1 AND "owner_account_id" = $2
        RETURNING "id"`,
        [instanceId, fromAccountId, toAccountId, state, cooldown],
      ),
    );
    if (moved.length === 0) {
      throw new BadRequestException('物品不存在或已不属于转出方');
    }

    // 真双录：转出 −1、转入 +1，于是「物品凭空产生」结构性不可能
    await m.query(
      `INSERT INTO "item_instance_entry" ("txn_id","instance_id","account_id","delta")
       VALUES ($1,$2,$3,-1), ($1,$2,$4,1)`,
      [txnId, instanceId, fromAccountId, toAccountId],
    );
  }

  // ---------------------------------------------------------------- 内部：杂项

  private async defOf(m: EntityManager, code: string): Promise<AssetDefRow> {
    const cached = this.defCache.get(code);
    if (cached) return cached;
    const rows = rowsOf<AssetDefRow>(
      await m.query(
        `SELECT "code","kind","expire_days","trade_cooldown_hours"
           FROM "asset_def" WHERE "code" = $1`,
        [code],
      ),
    );
    if (!rows[0]) throw new BadRequestException(`未知资产：${code}`);
    this.defCache.set(code, rows[0]);
    return rows[0];
  }

  private async actorBalances(
    actorUserId: string | undefined,
    byAccount: Map<string, Map<string, BalanceView>>,
  ): Promise<Record<string, BalanceView>> {
    if (!actorUserId) return {};
    const accountId = await this.accounts.peek({ userId: actorUserId });
    if (!accountId) return {};
    const mine = byAccount.get(accountId);
    if (!mine) return {};
    return Object.fromEntries(mine);
  }

  private toEntryView(r: EntryRow): EntryView {
    return {
      id: String(r.id),
      txnId: String(r.txn_id),
      assetCode: r.asset_code,
      delta: this.num(r.delta),
      frozenDelta: this.num(r.frozen_delta),
      balanceAfter: this.num(r.balance_after),
      frozenAfter: this.num(r.frozen_after),
      kind: r.kind,
      reason: r.reason,
      bizId: r.biz_id,
      refId: r.ref_id,
      createdAt: new Date(r.created_at).toISOString(),
    };
  }

  /**
   * bigint(string) → number。金额存 bigint 是为了不吃浮点误差、量级留足，
   * 但出参用 number（前端直接算够不够买，免 BigInt 解析）。
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

interface EntryRow {
  id: string;
  txn_id: string;
  asset_code: string;
  delta: string;
  frozen_delta: string;
  balance_after: string;
  frozen_after: string;
  kind: TxnKind;
  reason: string;
  biz_id: string;
  ref_id: string | null;
  created_at: Date;
}
