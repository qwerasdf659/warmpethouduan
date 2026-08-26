import { DataSource } from 'typeorm';
import { ClockService } from '../common/clock/clock.service';
import { LockService } from '../common/lock/lock.service';
import { ReconcileService } from './reconcile.service';

/**
 * 对账报告的判定逻辑。SQL 只挑出「可能有问题」的行，
 * 具体归类（不平 / 负余额）在 JS 里做，这里就测这段归类。
 */
describe('ReconcileService', () => {
  const clock: ClockService = {
    now: () => new Date('2026-01-01T00:00:00Z'),
    nowMs: () => 0,
  };

  interface Row {
    user_id: string;
    game_wallet: string;
    game_ledger: string;
    mkt_wallet: string;
    mkt_ledger: string;
  }

  /** 依次响应：可疑行 → 孤儿流水 → 钱包总数。 */
  function makeService(rows: Row[], orphans: string[] = [], count = 100) {
    const query = jest
      .fn()
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce(orphans.map((u) => ({ user_id: u })))
      .mockResolvedValueOnce([{ c: String(count) }]);
    return new ReconcileService(
      { query } as unknown as DataSource,
      {} as unknown as LockService,
      clock,
    );
  }

  const row = (over: Partial<Row> = {}): Row => ({
    user_id: '1',
    game_wallet: '100',
    game_ledger: '100',
    mkt_wallet: '0',
    mkt_ledger: '0',
    ...over,
  });

  it('全部对平：ok=true 且带上钱包总数', async () => {
    const svc = makeService([], [], 42);
    const r = await svc.run();

    expect(r.ok).toBe(true);
    expect(r.walletCount).toBe(42);
    expect(r.mismatches).toHaveLength(0);
  });

  it('余额多于流水：算出差额并标注池子', async () => {
    const svc = makeService([
      row({ user_id: '7', game_wallet: '777', game_ledger: '700' }),
    ]);
    const r = await svc.run();

    expect(r.ok).toBe(false);
    expect(r.mismatches).toEqual([
      { userId: '7', pool: 'game', wallet: 777, ledgerSum: 700, diff: 77 },
    ]);
  });

  it('两个池同时不平：各记一条', async () => {
    const svc = makeService([
      row({
        game_wallet: '10',
        game_ledger: '0',
        mkt_wallet: '0',
        mkt_ledger: '5',
      }),
    ]);
    const r = await svc.run();

    expect(r.mismatches.map((m) => m.pool)).toEqual(['game', 'marketing']);
    expect(r.mismatches[1].diff).toBe(-5);
  });

  it('负余额单独归类（经济层原子扣减不该允许出现）', async () => {
    const svc = makeService([
      row({ game_wallet: '-5', game_ledger: '-5' }), // 对平但为负
    ]);
    const r = await svc.run();

    expect(r.mismatches).toHaveLength(0);
    expect(r.negatives).toEqual([{ userId: '1', pool: 'game', amount: -5 }]);
    expect(r.ok).toBe(false);
  });

  it('孤儿流水（有流水没钱包）也让 ok 变 false', async () => {
    const svc = makeService([], ['9']);
    const r = await svc.run();

    expect(r.orphanLedgerUsers).toEqual(['9']);
    expect(r.ok).toBe(false);
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
