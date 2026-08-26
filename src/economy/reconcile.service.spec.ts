import { DataSource } from 'typeorm';
import { ClockService } from '../common/clock/clock.service';
import { LockService } from '../common/lock/lock.service';
import { ReconcileService } from './reconcile.service';

/**
 * 对账现在是「逐条跑 11 段 SQL，查出来就是异常」的结构，因此这里测的是**归类逻辑**：
 * 哪些查询结果算违反、单条 SQL 报错会不会拖垮整轮、以及单实例守卫。
 *
 * 各段 SQL 本身的正确性靠真库验证（`scripts/dev/ledger-smoke.ts`），
 * 用假 DataSource 去断言 SQL 文本只会测出「我写的字符串等于我写的字符串」。
 */
describe('ReconcileService', () => {
  const clock: ClockService = {
    now: () => new Date('2026-01-01T00:00:00Z'),
    nowMs: () => 0,
  };

  /** 11 段不变量 SQL 之后依次是：账户数、负债、日报物化。 */
  const TAIL_RESPONSES = [
    [{ c: '42' }], // accountCount
    [], // liabilities
    [], // materializeDailyStat
  ];

  /**
   * `violations` 是「第几条不变量」→「查出来的异常行」的映射（编号从 1 起）。
   * 未列出的不变量返回空数组（即成立）。
   */
  function makeService(violations: Record<number, unknown[]> = {}) {
    const query = jest.fn();
    for (let id = 1; id <= 11; id += 1) {
      query.mockResolvedValueOnce(violations[id] ?? []);
    }
    for (const tail of TAIL_RESPONSES) query.mockResolvedValueOnce(tail);
    return new ReconcileService(
      { query } as unknown as DataSource,
      {} as unknown as LockService,
      clock,
    );
  }

  it('全部成立：ok=true，11 项全部报告，带上账户数', async () => {
    const r = await makeService().run();

    expect(r.ok).toBe(true);
    expect(r.accountCount).toBe(42);
    expect(r.invariants).toHaveLength(11);
    expect(r.invariants.every((i) => i.ok)).toBe(true);
    expect(r.invariants.map((i) => i.id)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  it('某条查出异常行：该条 ok=false，整轮 ok=false，其余仍成立', async () => {
    const r = await makeService({
      2: [{ account_id: '7', asset_code: 'game_coin', available: '100' }],
    }).run();

    expect(r.ok).toBe(false);
    const broken = r.invariants.filter((i) => !i.ok);
    expect(broken).toHaveLength(1);
    expect(broken[0].id).toBe(2);
    expect(broken[0].count).toBe(1);
    expect(broken[0].samples[0]).toMatchObject({ account_id: '7' });
  });

  it('多条同时被违反：逐条归类，互不影响', async () => {
    const r = await makeService({
      1: [{ txn_id: '1' }],
      9: [{ account_id: '2' }, { account_id: '3' }],
    }).run();

    expect(r.invariants.filter((i) => !i.ok).map((i) => i.id)).toEqual([1, 9]);
    expect(r.invariants.find((i) => i.id === 9)?.count).toBe(2);
  });

  /**
   * 样本要截断：违反 10 万行时把全部结果塞进报告会把日志和后台响应打爆，
   * 而排障只需要前几条就能定位。
   */
  it('样本截断到 20 条，但 count 反映真实条数', async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: String(i) }));
    const r = await makeService({ 5: many }).run();

    const inv = r.invariants.find((i) => i.id === 5);
    expect(inv?.count).toBe(50);
    expect(inv?.samples).toHaveLength(20);
  });

  /**
   * 单条 SQL 执行失败（写错了、表被改名）不该让另外 10 条也拿不到结果 ——
   * 对账报告的价值恰恰在于「还有哪些是好的」。
   */
  it('单条 SQL 抛错：标记为不成立且 count=-1，不中断整轮', async () => {
    const query = jest.fn();
    query.mockResolvedValueOnce([]); // #1 ok
    query.mockRejectedValueOnce(
      new Error('relation "asset_lot" does not exist'),
    );
    for (let id = 3; id <= 11; id += 1) query.mockResolvedValueOnce([]);
    for (const tail of TAIL_RESPONSES) query.mockResolvedValueOnce(tail);

    const svc = new ReconcileService(
      { query } as unknown as DataSource,
      {} as unknown as LockService,
      clock,
    );
    const r = await svc.run();

    expect(r.invariants).toHaveLength(11);
    const failed = r.invariants.find((i) => i.id === 2);
    expect(failed?.ok).toBe(false);
    expect(failed?.count).toBe(-1);
    expect(r.ok).toBe(false);
    // 后续 9 条照常跑完
    expect(r.invariants.filter((i) => i.ok)).toHaveLength(10);
  });

  it('可兑资产没有流水时仍报出待兑付负债为 0（免得运维以为统计漏了）', async () => {
    const r = await makeService().run();
    expect(r.liabilities).toEqual([
      { assetCode: 'marketing_point', issued: 0, burned: 0, outstanding: 0 },
    ]);
  });

  it('非 0 号 worker 直接跳过，不碰 DB 也不抢锁', async () => {
    const query = jest.fn();
    const withLock = jest.fn();
    const svc = new ReconcileService(
      { query } as unknown as DataSource,
      { withLock } as unknown as LockService,
      clock,
    );

    const saved = process.env.NODE_APP_INSTANCE;
    process.env.NODE_APP_INSTANCE = '2';
    try {
      await svc.daily();
    } finally {
      if (saved === undefined) delete process.env.NODE_APP_INSTANCE;
      else process.env.NODE_APP_INSTANCE = saved;
    }

    expect(withLock).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});
