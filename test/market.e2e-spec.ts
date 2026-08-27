import { ReconcileService } from '../src/economy/reconcile.service';
import { AccountService } from '../src/ledger/account.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { RewardService } from '../src/ledger/reward.service';
import { GAME_COIN } from '../src/ledger/ledger.types';
import { MarketService } from '../src/market/market.service';
import { E2eApp } from './helpers/e2e-app';

/**
 * 交易市场（期 2~5）连真库验证。
 *
 * 四档功能共用同一套账本原语，因此这里重点验的是**凭证形状**在真库上确实守恒：
 * 回收销毁了实例、赠送两条腿求和为 0、成交三方分账进了 FEE 账户、
 * 竞价的钱确实被冻结且被超越时确实退回。
 *
 * 每个用例跑完都顺带查一遍对账不变量 —— 交易是唯一会同时动两个账户的路径，
 * 也是最容易把守恒写坏的地方。
 */
describe('交易市场 (e2e, 连真库)', () => {
  let e2e: E2eApp;
  let market: MarketService;
  let reward: RewardService;
  let ledger: LedgerService;
  let accounts: AccountService;
  let reconcile: ReconcileService;

  /** 全档打开 + 放宽风控，个别用例再单独收紧。 */
  const OPEN_MARKET = {
    'market.enabled': true,
    'market.features': {
      recycle: true,
      gift: true,
      listing: true,
      auction: true,
      trade: true,
    },
    'market.risk': {
      minAccountAgeDays: 7,
      maxTradesPerDay: 50,
      maxValuePerDay: 10_000_000,
      abnormalPriceRatio: 5,
    },
    'market.priceBand': { enabled: true, minBps: 3000, maxBps: 30000 },
    'market.feeBps': 500,
    'market.listingHours': 72,
    'market.recycleRateBps': 3000,
  };

  beforeAll(async () => {
    e2e = await E2eApp.boot();
    market = e2e.app.get(MarketService);
    reward = e2e.app.get(RewardService);
    ledger = e2e.app.get(LedgerService);
    accounts = e2e.app.get(AccountService);
    reconcile = e2e.app.get(ReconcileService);
  }, 60_000);

  afterAll(async () => {
    await e2e.teardown();
  }, 60_000);

  const uniq = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  /** 建一个「已过新号冷却」的玩家，可选起始余额。 */
  async function trader(game = 0) {
    const p = await e2e.createPlayer();
    await e2e.backdateRegistration(p.userId, 30);
    if (game > 0) await e2e.fundWallet(p.userId, { game });
    return p;
  }

  /**
   * 发一件唯一物品并让它立刻可交易。
   *
   * 铸造时 `tradable_after = now() + 72h`（R2，防盗号即刻套现），
   * 所以 e2e 必须把它拨到过去，否则每个交易用例都会撞冷却。
   */
  async function giveTradableInstance(userId: string, assetCode: string) {
    await reward.grant(userId, [{ assetCode, count: 1 }], {
      reason: 'compensation',
      bizKey: `m:${uniq()}`,
    });
    const [inst] = await e2e.instancesOf(userId, assetCode);
    await e2e.db.query(
      `UPDATE item_instance SET tradable_after = now() - interval '1 hour' WHERE id = $1`,
      [inst.instanceId],
    );
    return inst;
  }

  async function feeBalance(): Promise<number> {
    const accountId = await accounts.peek({ systemCode: 'FEE' });
    if (!accountId) return 0;
    const rows = await e2e.db.query<{ available: string }[]>(
      `SELECT available FROM asset_balance WHERE account_id = $1 AND asset_code = $2`,
      [accountId, GAME_COIN],
    );
    return Number(rows[0]?.available ?? 0);
  }

  async function escrowInstanceCount(): Promise<number> {
    const rows = await e2e.db.query<{ n: string }[]>(
      `SELECT count(*) n FROM item_instance i
         JOIN account a ON a.id = i.owner_account_id
        WHERE a.system_code = 'ESCROW'`,
    );
    return Number(rows[0].n);
  }

  /**
   * 从一条违反样本里取账户 id（显式判类型的理由见 ledger.e2e-spec 的同名函数）。
   */
  function accountIdOf(sample: Record<string, unknown>): string | null {
    const raw = sample.account_id;
    if (typeof raw === 'string') return raw;
    if (typeof raw === 'number' || typeof raw === 'bigint') return String(raw);
    return null;
  }

  /** 本用例涉及账户上的不变量违反（按账户收敛，避免被开发库里的历史脏数据连坐）。 */
  async function violationsFor(userIds: string[]) {
    const mine = new Set(
      await Promise.all(userIds.map((u) => accounts.peek({ userId: u }))),
    );
    const report = await reconcile.run();
    return report.invariants
      .filter((i) => !i.ok)
      .map((i) => ({
        id: i.id,
        samples: i.samples.filter((s) => {
          const acc = accountIdOf(s);
          return acc !== null && mine.has(acc);
        }),
      }))
      .filter((i) => i.samples.length > 0);
  }

  // ================================================================ R10 总闸

  describe('总开关与分档开关（R10）', () => {
    it('总开关关闭时所有档位一律拒绝', async () => {
      const p = await trader(1000);
      await e2e.withConfig(
        { ...OPEN_MARKET, 'market.enabled': false },
        async () => {
          await expect(
            market.recycle(p.userId, { assetCode: 'cons_toy', qty: 1 }, uniq()),
          ).rejects.toThrow(/暂未开放/);
        },
      );
    });

    it('总开关开着但分档未开时只拒绝该档', async () => {
      const seller = await trader();
      await reward.grant(seller.userId, [{ assetCode: 'cons_toy', count: 2 }], {
        reason: 'compensation',
        bizKey: `g:${uniq()}`,
      });

      await e2e.withConfig(
        {
          ...OPEN_MARKET,
          'market.features': {
            recycle: true,
            gift: false,
            listing: false,
            auction: false,
            trade: false,
          },
        },
        async () => {
          const buyer = await trader();
          await expect(
            market.gift(
              seller.userId,
              buyer.userId,
              { assetCode: 'cons_toy', qty: 1 },
              uniq(),
            ),
          ).rejects.toThrow(/暂未开放/);
          // 回收这一档是开着的
          await expect(
            market.recycle(
              seller.userId,
              { assetCode: 'cons_toy', qty: 1 },
              uniq(),
            ),
          ).resolves.toMatchObject({ assetCode: GAME_COIN });
        },
      );
    });
  });

  // ================================================================ 3a 回收

  describe('3a 系统回收', () => {
    it('可堆叠资产按折扣价回收：件数减少、货币增加', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const p = await trader();
        await reward.grant(p.userId, [{ assetCode: 'furn_sofa', count: 2 }], {
          reason: 'compensation',
          bizKey: `g:${uniq()}`,
        });

        // 沙发商店价 900，回收率 30% → 270
        const res = await market.recycle(
          p.userId,
          { assetCode: 'furn_sofa', qty: 1 },
          uniq(),
        );

        expect(res.gained).toBe(270);
        expect(await e2e.ownedQty(p.userId, 'furn_sofa')).toBe(1);
        expect(await e2e.walletOf(p.userId)).toMatchObject({ gameCoin: 270 });
        expect(await violationsFor([p.userId])).toEqual([]);
      });
    });

    /**
     * 回收率必须低于 100%，否则「买入再回收」就是无风险套利，
     * 玩家会把商店当刷币机。这里验的是这条经济学约束真的生效。
     */
    it('买入再回收必然亏损（回收不是套利通道）', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const p = await trader(1000);
        const before = (await e2e.walletOf(p.userId)).gameCoin;

        await reward.exchange(
          p.userId,
          [{ assetCode: GAME_COIN, count: 900 }],
          [{ assetCode: 'furn_sofa', count: 1 }],
          { reason: 'purchase', bizKey: `buy:${uniq()}` },
        );
        await market.recycle(
          p.userId,
          { assetCode: 'furn_sofa', qty: 1 },
          uniq(),
        );

        expect((await e2e.walletOf(p.userId)).gameCoin).toBeLessThan(before);
      });
    });

    /**
     * 唯一物品的销毁：实例落 `burned` 终态、分录求和从 1 变 0。
     * 对账不变量 5 要求这两者必须一致 —— 只改状态不写分录（或反之）都会被抓到。
     */
    it('唯一物品回收后落 burned 终态，不再计入持有', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const p = await trader();
        const inst = await giveTradableInstance(p.userId, 'skin_snow');

        await market.recycle(p.userId, { instanceId: inst.instanceId }, uniq());

        expect(await e2e.ownedQty(p.userId, 'skin_snow')).toBe(0);
        const rows = await e2e.db.query<{ state: string; sum: string }[]>(
          `SELECT i.state, COALESCE(SUM(e.delta), 0) AS sum
             FROM item_instance i
             LEFT JOIN item_instance_entry e ON e.instance_id = i.id
            WHERE i.id = $1 GROUP BY i.state`,
          [inst.instanceId],
        );
        expect(rows[0].state).toBe('burned');
        expect(Number(rows[0].sum)).toBe(0);
        expect(await violationsFor([p.userId])).toEqual([]);
      });
    });

    /**
     * 回收款不能是可兑实物的资产。
     *
     * 计价资产是运营在后台可改的（物品编辑里的「积分池」），改成营销积分之后
     * 回收就变成「道具 → 可兑实物的积分」，也就是把游戏内产出换成了实物 ——
     * 正是 §3 要断掉的那一环。数据库 CHECK 拦不住这个组合：
     * `marketing_point` 自己 `redeemable=true` 完全合法，问题出在「用它付款」上。
     */
    it('计价资产可兑实物时拒绝回收（堵住道具→实物的通路）', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const p = await trader();
        await reward.grant(p.userId, [{ assetCode: 'furn_bowl', count: 1 }], {
          reason: 'compensation',
          bizKey: `g:${uniq()}`,
        });

        // 模拟运营把这件家具的计价池改成营销积分
        await e2e.db.query(
          `UPDATE asset_def
              SET meta = jsonb_set(meta, '{priceAsset}', '"marketing_point"')
            WHERE code = 'furn_bowl'`,
        );
        try {
          await expect(
            market.recycle(
              p.userId,
              { assetCode: 'furn_bowl', qty: 1 },
              uniq(),
            ),
          ).rejects.toThrow(/可兑实物/);
        } finally {
          await e2e.db.query(
            `UPDATE asset_def
                SET meta = jsonb_set(meta, '{priceAsset}', '"game_coin"')
              WHERE code = 'furn_bowl'`,
          );
        }
      });
    });

    /**
     * 回收不要求 `tradable`：它没有对手方，不构成玩家间流转，
     * 因此不触及「开箱变现」那条红线。扭蛋限定款也该有个处置出口。
     */
    it('不可交易的扭蛋限定款也能回收给系统', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const p = await trader();
        await reward.grant(p.userId, [{ assetCode: 'cons_snack', count: 1 }], {
          reason: 'compensation',
          bizKey: `g:${uniq()}`,
        });

        await expect(
          market.recycle(p.userId, { assetCode: 'cons_snack', qty: 1 }, uniq()),
        ).resolves.toMatchObject({ gained: 18 });
      });
    });
  });

  // ================================================================ 3b 赠送

  describe('3b 定向赠送', () => {
    it('可堆叠资产赠送：两条分录求和为 0', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const a = await trader();
        const b = await trader();
        await reward.grant(a.userId, [{ assetCode: 'furn_lamp', count: 3 }], {
          reason: 'compensation',
          bizKey: `g:${uniq()}`,
        });

        await market.gift(
          a.userId,
          b.userId,
          { assetCode: 'furn_lamp', qty: 2 },
          uniq(),
        );

        expect(await e2e.ownedQty(a.userId, 'furn_lamp')).toBe(1);
        expect(await e2e.ownedQty(b.userId, 'furn_lamp')).toBe(2);
        expect(await violationsFor([a.userId, b.userId])).toEqual([]);
      });
    });

    it('唯一物品赠送：实例换手，编号随之转移', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const a = await trader();
        const b = await trader();
        const inst = await giveTradableInstance(a.userId, 'acc_crown');

        await market.gift(
          a.userId,
          b.userId,
          { instanceId: inst.instanceId },
          uniq(),
        );

        expect(await e2e.ownedQty(a.userId, 'acc_crown')).toBe(0);
        const received = await e2e.instancesOf(b.userId, 'acc_crown');
        expect(received).toHaveLength(1);
        expect(received[0].instanceId).toBe(inst.instanceId);
        expect(await violationsFor([a.userId, b.userId])).toEqual([]);
      });
    });

    /** R4：净流出双向记账，为「小号供养大号」的日报打基础。 */
    it('赠送双方都记入日统计，净流出方向相反', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const a = await trader();
        const b = await trader();
        await reward.grant(a.userId, [{ assetCode: 'furn_bowl', count: 1 }], {
          reason: 'compensation',
          bizKey: `g:${uniq()}`,
        });

        await market.gift(
          a.userId,
          b.userId,
          { assetCode: 'furn_bowl', qty: 1 },
          uniq(),
        );

        const rows = await e2e.db.query<
          { user_id: string; net_outflow: string }[]
        >(
          `SELECT a.user_id, r.net_outflow FROM trade_risk_daily r
             JOIN account a ON a.id = r.account_id
            WHERE a.user_id = ANY($1::bigint[])`,
          [[a.userId, b.userId]],
        );
        const sender = rows.find((r) => String(r.user_id) === a.userId);
        const receiver = rows.find((r) => String(r.user_id) === b.userId);
        expect(Number(sender?.net_outflow)).toBe(200);
        expect(Number(receiver?.net_outflow)).toBe(-200);
      });
    });

    /** R1：新号交易冷却。 */
    it('新注册账号不能赠送', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const fresh = await e2e.createPlayer();
        const b = await trader();
        await reward.grant(
          fresh.userId,
          [{ assetCode: 'furn_bowl', count: 1 }],
          { reason: 'compensation', bizKey: `g:${uniq()}` },
        );

        await expect(
          market.gift(
            fresh.userId,
            b.userId,
            { assetCode: 'furn_bowl', qty: 1 },
            uniq(),
          ),
        ).rejects.toThrow(/天后才能交易/);
      });
    });

    /** R3：单日笔数上限。 */
    it('超出单日交易笔数上限后拒绝', async () => {
      await e2e.withConfig(
        {
          ...OPEN_MARKET,
          'market.risk': {
            minAccountAgeDays: 0,
            maxTradesPerDay: 1,
            maxValuePerDay: 10_000_000,
            abnormalPriceRatio: 5,
          },
        },
        async () => {
          const a = await trader();
          const b = await trader();
          await reward.grant(a.userId, [{ assetCode: 'furn_bowl', count: 5 }], {
            reason: 'compensation',
            bizKey: `g:${uniq()}`,
          });

          await market.gift(
            a.userId,
            b.userId,
            { assetCode: 'furn_bowl', qty: 1 },
            uniq(),
          );
          await expect(
            market.gift(
              a.userId,
              b.userId,
              { assetCode: 'furn_bowl', qty: 1 },
              uniq(),
            ),
          ).rejects.toThrow(/次数已达上限/);
        },
      );
    });

    /** 合规红线：扭蛋产出物不可在玩家间流转。 */
    it('不可交易资产不能赠送（堵住开箱变现链路）', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const a = await trader();
        const b = await trader();
        await reward.grant(a.userId, [{ assetCode: 'cons_snack', count: 1 }], {
          reason: 'compensation',
          bizKey: `g:${uniq()}`,
        });

        await expect(
          market.gift(
            a.userId,
            b.userId,
            { assetCode: 'cons_snack', qty: 1 },
            uniq(),
          ),
        ).rejects.toThrow(/不可交易/);
      });
    });

    /** R2：获得后冷却，防盗号即刻套现。 */
    it('冷却期内的物品不能出手', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const a = await trader();
        const b = await trader();
        // 不拨 tradable_after：保持铸造时的 now()+72h
        await reward.grant(a.userId, [{ assetCode: 'acc_cap', count: 1 }], {
          reason: 'compensation',
          bizKey: `g:${uniq()}`,
        });
        const [inst] = await e2e.instancesOf(a.userId, 'acc_cap');

        await expect(
          market.gift(
            a.userId,
            b.userId,
            { instanceId: inst.instanceId },
            uniq(),
          ),
        ).rejects.toThrow(/后才可交易/);
      });
    });

    it('不能赠送给自己，也不能赠送给不存在的玩家', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const a = await trader();
        await expect(
          market.gift(
            a.userId,
            a.userId,
            { assetCode: 'furn_bowl', qty: 1 },
            uniq(),
          ),
        ).rejects.toThrow(/不能赠送给自己/);
        await expect(
          market.gift(
            a.userId,
            '999999999',
            { assetCode: 'furn_bowl', qty: 1 },
            uniq(),
          ),
        ).rejects.toThrow(/不存在/);
      });
    });
  });

  // ================================================================ 3c 寄售

  describe('3c 一价寄售', () => {
    it('挂单把唯一物品转入 ESCROW，玩家背包里不再有它', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const seller = await trader();
        const inst = await giveTradableInstance(seller.userId, 'skin_tiger');
        const escrowBefore = await escrowInstanceCount();

        const listing = await market.list(
          seller.userId,
          { instanceId: inst.instanceId },
          900,
          'fixed',
          uniq(),
        );

        expect(listing.status).toBe('listed');
        expect(await e2e.ownedQty(seller.userId, 'skin_tiger')).toBe(0);
        expect(await escrowInstanceCount()).toBe(escrowBefore + 1);
        // 不变量 7：ESCROW 持有数 == listed/escrowed 状态数
        expect(await violationsFor([seller.userId])).toEqual([]);
      });
    });

    it('挂单把可堆叠资产的可用余额转为冻结（总量不变）', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const seller = await trader();
        await reward.grant(
          seller.userId,
          [{ assetCode: 'furn_rug', count: 3 }],
          { reason: 'compensation', bizKey: `g:${uniq()}` },
        );

        await market.list(
          seller.userId,
          { assetCode: 'furn_rug', qty: 2 },
          700,
          'fixed',
          uniq(),
        );

        const balances = await ledger.balances(seller.userId);
        expect(balances['furn_rug']).toEqual({ available: 1, frozen: 2 });
        expect(await violationsFor([seller.userId])).toEqual([]);
      });
    });

    /** 手续费进 FEE 账户即退出流通，这是交易带来的通胀 sink（R9）。 */
    it('成交三方分账：买家付款、卖家收款减手续费、FEE 收手续费', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const seller = await trader();
        const buyer = await trader(2000);
        const inst = await giveTradableInstance(seller.userId, 'skin_calico');
        const feeBefore = await feeBalance();

        const listing = await market.list(
          seller.userId,
          { instanceId: inst.instanceId },
          1000,
          'fixed',
          uniq(),
        );
        await market.buyNow(listing.id, buyer.userId);

        // 费率 5%：买家 −1000，卖家 +950，FEE +50
        expect(await e2e.walletOf(buyer.userId)).toMatchObject({
          gameCoin: 1000,
        });
        expect(await e2e.walletOf(seller.userId)).toMatchObject({
          gameCoin: 950,
        });
        expect(await feeBalance()).toBe(feeBefore + 50);

        // 物品到买家手上
        expect(await e2e.ownedQty(buyer.userId, 'skin_calico')).toBe(1);
        expect(await e2e.ownedQty(seller.userId, 'skin_calico')).toBe(0);
        expect(await violationsFor([seller.userId, buyer.userId])).toEqual([]);
      });
    });

    it('可堆叠标的成交：卖家的冻结份额转给买家', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const seller = await trader();
        const buyer = await trader(5000);
        await reward.grant(
          seller.userId,
          [{ assetCode: 'furn_tree', count: 2 }],
          { reason: 'compensation', bizKey: `g:${uniq()}` },
        );

        const listing = await market.list(
          seller.userId,
          { assetCode: 'furn_tree', qty: 2 },
          2600,
          'fixed',
          uniq(),
        );
        await market.buyNow(listing.id, buyer.userId);

        expect(await e2e.ownedQty(buyer.userId, 'furn_tree')).toBe(2);
        const sellerBalances = await ledger.balances(seller.userId);
        expect(sellerBalances['furn_tree']?.frozen ?? 0).toBe(0);
        expect(sellerBalances['furn_tree']?.available ?? 0).toBe(0);
        expect(await violationsFor([seller.userId, buyer.userId])).toEqual([]);
      });
    });

    it('撤单把标的原样退回，且不重置交易冷却', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const seller = await trader();
        const inst = await giveTradableInstance(seller.userId, 'bg_garden');

        const listing = await market.list(
          seller.userId,
          { instanceId: inst.instanceId },
          800,
          'fixed',
          uniq(),
        );
        await market.cancel(listing.id, seller.userId, uniq());

        expect(await e2e.ownedQty(seller.userId, 'bg_garden')).toBe(1);
        const [back] = await e2e.instancesOf(seller.userId, 'bg_garden');
        expect(back.state).toBe('held');
        // 冷却没被刷新：拿回自己的东西不该重新罚 72 小时
        const rows = await e2e.db.query<{ ok: boolean }[]>(
          `SELECT tradable_after <= now() AS ok FROM item_instance WHERE id = $1`,
          [inst.instanceId],
        );
        expect(rows[0].ok).toBe(true);
        expect(await violationsFor([seller.userId])).toEqual([]);
      });
    });

    it('余额不足时买不动，挂单保持在售', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const seller = await trader();
        const poor = await trader(10);
        const inst = await giveTradableInstance(seller.userId, 'acc_glasses');

        const listing = await market.list(
          seller.userId,
          { instanceId: inst.instanceId },
          700,
          'fixed',
          uniq(),
        );
        await expect(market.buyNow(listing.id, poor.userId)).rejects.toThrow();

        const rows = await e2e.db.query<{ status: string }[]>(
          `SELECT status FROM market_listing WHERE id = $1`,
          [listing.id],
        );
        expect(rows[0].status).toBe('listed');
      });
    });

    /** 自买自卖是刷成交量与洗白异常价格的标准手法。 */
    it('不能买自己的挂单', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const seller = await trader(5000);
        const inst = await giveTradableInstance(seller.userId, 'acc_bandana');
        const listing = await market.list(
          seller.userId,
          { instanceId: inst.instanceId },
          500,
          'fixed',
          uniq(),
        );

        await expect(market.buyNow(listing.id, seller.userId)).rejects.toThrow(
          /不能买自己/,
        );
      });
    });

    it('已成交的挂单不能再次买入', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const seller = await trader();
        const b1 = await trader(3000);
        const b2 = await trader(3000);
        const inst = await giveTradableInstance(seller.userId, 'bg_starry');

        const listing = await market.list(
          seller.userId,
          { instanceId: inst.instanceId },
          1800,
          'fixed',
          uniq(),
        );
        await market.buyNow(listing.id, b1.userId);
        await expect(market.buyNow(listing.id, b2.userId)).rejects.toThrow(
          /已结束/,
        );
      });
    });

    /**
     * R6：「1 币挂一件高价皮肤」是站外私下交易的标准手法 ——
     * 站外微信转账，站内用荒谬低价完成交割。限价把这条通道压掉。
     */
    it('限价区间外的挂单被拒（堵住站外交易通道）', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const seller = await trader();
        const inst = await giveTradableInstance(seller.userId, 'skin_aurora');

        // 商店价 5000，区间 30%~300% → 1500~15000
        await expect(
          market.list(
            seller.userId,
            { instanceId: inst.instanceId },
            1,
            'fixed',
            uniq(),
          ),
        ).rejects.toThrow(/挂单价需在/);
        await expect(
          market.list(
            seller.userId,
            { instanceId: inst.instanceId },
            999_999,
            'fixed',
            uniq(),
          ),
        ).rejects.toThrow(/挂单价需在/);
      });
    });

    it('同一实例不能同时挂两单', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const seller = await trader();
        const inst = await giveTradableInstance(seller.userId, 'acc_bell');

        await market.list(
          seller.userId,
          { instanceId: inst.instanceId },
          350,
          'fixed',
          uniq(),
        );
        // 已经在 ESCROW 名下，第二次挂单查不到这件物品
        await expect(
          market.list(
            seller.userId,
            { instanceId: inst.instanceId },
            350,
            'fixed',
            uniq(),
          ),
        ).rejects.toThrow();
      });
    });

    /** 用可堆叠标的跑这条：它走的是「冻结→解冻」而不是「ESCROW→退回」，是另一条代码路径。 */
    it('超时挂单自动退回标的（可堆叠：冻结额度全部解冻）', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const seller = await trader();
        await reward.grant(
          seller.userId,
          [{ assetCode: 'furn_window', count: 1 }],
          { reason: 'compensation', bizKey: `g:${uniq()}` },
        );

        const listing = await market.list(
          seller.userId,
          { assetCode: 'furn_window', qty: 1 },
          1600,
          'fixed',
          uniq(),
        );
        expect((await ledger.balances(seller.userId))['furn_window']).toEqual({
          available: 0,
          frozen: 1,
        });
        await e2e.db.query(
          `UPDATE market_listing SET expires_at = now() - interval '1 hour' WHERE id = $1`,
          [listing.id],
        );

        const expired = await market.findExpiredListings();
        expect(expired).toContain(listing.id);
        await market.handleExpired(listing.id);

        expect((await ledger.balances(seller.userId))['furn_window']).toEqual({
          available: 1,
          frozen: 0,
        });
        const rows = await e2e.db.query<{ status: string }[]>(
          `SELECT status FROM market_listing WHERE id = $1`,
          [listing.id],
        );
        expect(rows[0].status).toBe('expired');
        expect(await violationsFor([seller.userId])).toEqual([]);
      });
    });

    it('浏览只返回在售且未过期的挂单', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const seller = await trader();
        const inst = await giveTradableInstance(seller.userId, 'skin_tiger');
        const listing = await market.list(
          seller.userId,
          { instanceId: inst.instanceId },
          900,
          'fixed',
          uniq(),
        );

        const page = await market.browse({
          assetCode: 'skin_tiger',
          page: 1,
          pageSize: 50,
        });
        expect(page.list.map((l) => l.id)).toContain(listing.id);

        await market.cancel(listing.id, seller.userId, uniq());
        const after = await market.browse({
          assetCode: 'skin_tiger',
          page: 1,
          pageSize: 50,
        });
        expect(after.list.map((l) => l.id)).not.toContain(listing.id);
      });
    });
  });

  // ================================================================ 3d 竞价

  describe('3d 自由竞价', () => {
    it('出价冻结买家资金（可用减少、冻结增加，总量不变）', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const seller = await trader();
        const bidder = await trader(3000);
        const inst = await giveTradableInstance(seller.userId, 'skin_calico');

        const listing = await market.list(
          seller.userId,
          { instanceId: inst.instanceId },
          1000,
          'auction',
          uniq(),
        );
        await market.bid(listing.id, bidder.userId, 1200, uniq());

        const balances = await ledger.balances(bidder.userId);
        expect(balances[GAME_COIN]).toEqual({
          available: 1800,
          frozen: 1200,
        });
        expect(await violationsFor([bidder.userId])).toEqual([]);
      });
    });

    /**
     * 被超越必须解冻。不解冻的话，一个买家的钱会被永久冻在一堆已经输掉的
     * 出价上 —— 而冻结余额没有任何自动释放机制。
     */
    it('被超越时上一个最高价全额解冻', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const seller = await trader();
        const b1 = await trader(3000);
        const b2 = await trader(3000);
        const inst = await giveTradableInstance(seller.userId, 'skin_tiger');

        const listing = await market.list(
          seller.userId,
          { instanceId: inst.instanceId },
          900,
          'auction',
          uniq(),
        );
        await market.bid(listing.id, b1.userId, 1000, uniq());
        await market.bid(listing.id, b2.userId, 1500, uniq());

        // b1 的钱全退回可用
        expect((await ledger.balances(b1.userId))[GAME_COIN]).toEqual({
          available: 3000,
          frozen: 0,
        });
        expect((await ledger.balances(b2.userId))[GAME_COIN]).toEqual({
          available: 1500,
          frozen: 1500,
        });

        const bids = await e2e.db.query<{ status: string; price: string }[]>(
          `SELECT status, price FROM market_bid WHERE listing_id = $1 ORDER BY price`,
          [listing.id],
        );
        expect(bids.map((b) => b.status)).toEqual(['outbid', 'active']);
        expect(await violationsFor([b1.userId, b2.userId])).toEqual([]);
      });
    });

    it('出价必须高于起拍价与当前最高价', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const seller = await trader();
        const b1 = await trader(5000);
        const b2 = await trader(5000);
        const inst = await giveTradableInstance(seller.userId, 'skin_calico');

        const listing = await market.list(
          seller.userId,
          { instanceId: inst.instanceId },
          1000,
          'auction',
          uniq(),
        );

        await expect(
          market.bid(listing.id, b1.userId, 500, uniq()),
        ).rejects.toThrow(/不得低于起拍价/);

        await market.bid(listing.id, b1.userId, 1200, uniq());
        await expect(
          market.bid(listing.id, b2.userId, 1200, uniq()),
        ).rejects.toThrow(/必须高于当前最高价/);
        await expect(
          market.bid(listing.id, b1.userId, 1300, uniq()),
        ).rejects.toThrow(/已是最高出价者/);
      });
    });

    /**
     * 结算时中标者付的是**冻结中的钱**（frozenDelta=−price、delta=0），
     * 卖家收的是可用余额。因此平衡口径必须算 delta+frozenDelta —— 这条用例
     * 就是那个口径的回归测试。
     */
    it('结算：中标者的冻结资金转给卖家与 FEE，物品判给中标者', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const seller = await trader();
        // 出价会冻结全额，因此买家的可用余额必须**不低于出价** —— 8000 > 6000
        const winner = await trader(8000);
        const loser = await trader(5000);
        const inst = await giveTradableInstance(seller.userId, 'skin_aurora');
        const feeBefore = await feeBalance();

        const listing = await market.list(
          seller.userId,
          { instanceId: inst.instanceId },
          5000,
          'auction',
          uniq(),
        );
        await market.bid(listing.id, loser.userId, 5000, uniq());
        await market.bid(listing.id, winner.userId, 6000, uniq());

        const res = await market.settleAuction(listing.id);
        expect(res.sold).toBe(true);

        // 中标者：6000 从冻结里扣走，剩下 2000 可用
        expect((await ledger.balances(winner.userId))[GAME_COIN]).toEqual({
          available: 2000,
          frozen: 0,
        });
        // 卖家收 6000 − 5% = 5700
        expect(await e2e.walletOf(seller.userId)).toMatchObject({
          gameCoin: 5700,
        });
        expect(await feeBalance()).toBe(feeBefore + 300);
        // 落败者的钱早在被超越时就退了
        expect((await ledger.balances(loser.userId))[GAME_COIN]).toEqual({
          available: 5000,
          frozen: 0,
        });
        expect(await e2e.ownedQty(winner.userId, 'skin_aurora')).toBe(1);

        expect(
          await violationsFor([seller.userId, winner.userId, loser.userId]),
        ).toEqual([]);
      });
    });

    it('流拍（无人出价）：标的退回卖家，挂单落 expired', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const seller = await trader();
        const inst = await giveTradableInstance(seller.userId, 'acc_scarf');

        const listing = await market.list(
          seller.userId,
          { instanceId: inst.instanceId },
          600,
          'auction',
          uniq(),
        );
        const res = await market.settleAuction(listing.id);

        expect(res.sold).toBe(false);
        expect(await e2e.ownedQty(seller.userId, 'acc_scarf')).toBe(1);
        const rows = await e2e.db.query<{ status: string }[]>(
          `SELECT status FROM market_listing WHERE id = $1`,
          [listing.id],
        );
        expect(rows[0].status).toBe('expired');
        expect(await violationsFor([seller.userId])).toEqual([]);
      });
    });

    /** 撤单时若还有活跃出价，那些钱必须一起解冻。 */
    it('撤单会把所有活跃出价解冻', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const seller = await trader();
        const bidder = await trader(3000);
        const inst = await giveTradableInstance(seller.userId, 'skin_snow');

        const listing = await market.list(
          seller.userId,
          { instanceId: inst.instanceId },
          400,
          'auction',
          uniq(),
        );
        await market.bid(listing.id, bidder.userId, 500, uniq());
        expect((await ledger.balances(bidder.userId))[GAME_COIN].frozen).toBe(
          500,
        );

        await market.cancel(listing.id, seller.userId, uniq());

        expect((await ledger.balances(bidder.userId))[GAME_COIN]).toEqual({
          available: 3000,
          frozen: 0,
        });
        expect(await e2e.ownedQty(seller.userId, 'skin_snow')).toBe(1);
        expect(await violationsFor([seller.userId, bidder.userId])).toEqual([]);
      });
    });

    it('一价挂单不接受出价，竞价挂单不接受一价买入', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const seller = await trader();
        const buyer = await trader(5000);
        const fixedInst = await giveTradableInstance(
          seller.userId,
          'skin_tiger',
        );
        const auctionInst = await giveTradableInstance(
          seller.userId,
          'skin_calico',
        );

        const fixed = await market.list(
          seller.userId,
          { instanceId: fixedInst.instanceId },
          900,
          'fixed',
          uniq(),
        );
        const auction = await market.list(
          seller.userId,
          { instanceId: auctionInst.instanceId },
          1400,
          'auction',
          uniq(),
        );

        await expect(
          market.bid(fixed.id, buyer.userId, 1000, uniq()),
        ).rejects.toThrow(/不接受出价/);
        await expect(market.buyNow(auction.id, buyer.userId)).rejects.toThrow(
          /竞价挂单不能一价买入/,
        );
      });
    });
  });

  // ================================================================ 后台运维

  describe('后台强制撤单', () => {
    /**
     * 与玩家撤单的唯一区别是不校验归属，其余（退回标的、解冻全部活跃出价、落终态）
     * 必须完全一致 —— 走的就是同一个 `unwind`。这条用例守的正是「没有走出第二份实现」。
     */
    it('不校验归属：退回标的并解冻全部活跃出价', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const seller = await trader();
        const bidder = await trader(3000);
        const inst = await giveTradableInstance(seller.userId, 'skin_tiger');

        const listing = await market.list(
          seller.userId,
          { instanceId: inst.instanceId },
          900,
          'auction',
          uniq(),
        );
        await market.bid(listing.id, bidder.userId, 1000, uniq());
        expect((await ledger.balances(bidder.userId))[GAME_COIN].frozen).toBe(
          1000,
        );

        // 后台不需要知道卖家是谁
        const res = await market.forceCancel(listing.id, 'e2e 违规挂单');
        expect(res).toMatchObject({ ok: true, listingId: listing.id });

        expect(await e2e.ownedQty(seller.userId, 'skin_tiger')).toBe(1);
        expect((await ledger.balances(bidder.userId))[GAME_COIN]).toEqual({
          available: 3000,
          frozen: 0,
        });
        const rows = await e2e.db.query<{ status: string }[]>(
          `SELECT status FROM market_listing WHERE id = $1`,
          [listing.id],
        );
        expect(rows[0].status).toBe('cancelled');
        expect(await violationsFor([seller.userId, bidder.userId])).toEqual([]);
      });
    });

    it('已结束的挂单不能再强制撤单', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const seller = await trader();
        const inst = await giveTradableInstance(seller.userId, 'skin_snow');
        const listing = await market.list(
          seller.userId,
          { instanceId: inst.instanceId },
          400,
          'fixed',
          uniq(),
        );
        await market.cancel(listing.id, seller.userId, uniq());

        await expect(
          market.forceCancel(listing.id, 'e2e 重复撤单'),
        ).rejects.toThrow(/已结束/);
      });
    });

    /** 后台挂单查询要能看到已结束的单 —— 处理纠纷时看的正是这些。 */
    it('后台查询能看到已结束的挂单（玩家端 browse 看不到）', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const seller = await trader();
        const inst = await giveTradableInstance(seller.userId, 'acc_bow');
        const listing = await market.list(
          seller.userId,
          { instanceId: inst.instanceId },
          450,
          'fixed',
          uniq(),
        );
        await market.cancel(listing.id, seller.userId, uniq());

        const browse = await market.browse({ page: 1, pageSize: 100 });
        expect(browse.list.map((l) => l.id)).not.toContain(listing.id);

        const admin = await market.adminListings({
          page: 1,
          pageSize: 100,
          status: 'cancelled',
          sellerUserId: seller.userId,
        });
        expect(admin.list.map((l) => l.id)).toContain(listing.id);
      });
    });
  });

  describe('货币不能作为交易标的', () => {
    it('拒绝把 game_coin 挂到市场（不存在汇兑市场）', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const p = await trader(1000);
        await expect(
          market.list(
            p.userId,
            { assetCode: GAME_COIN, qty: 100 },
            100,
            'fixed',
            uniq(),
          ),
        ).rejects.toThrow(/货币不能作为交易标的/);
      });
    });
  });

  // ================================================================ 并发与竞态
  /**
   * 并发回归。前面的用例都是串行的，验的是「凭证形状守恒」；这里验的是
   * **多个请求同时打同一资源时，`withLock` 与数据库唯一约束能不能兜住**——
   * 交易是全项目唯一会同时动两个账户、且天然会被多人争抢（同一件热门挂单）
   * 的路径，一旦锁写漏就是「一物两卖」「钱冻死」「额度超发」。
   */
  describe('并发与竞态（回归）', () => {
    /** 一件唯一物品被多人同时抢购：锁必须裁决出唯一赢家，物品只能归一人。 */
    it('并发一价买入同一挂单：恰好一人成交，物品只归一人', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const seller = await trader();
        const inst = await giveTradableInstance(seller.userId, 'skin_tiger');
        const price = 900;
        const buyers = await Promise.all(
          Array.from({ length: 6 }, () => trader(price)),
        );

        const listing = await market.list(
          seller.userId,
          { instanceId: inst.instanceId },
          price,
          'fixed',
          uniq(),
        );

        const results = await Promise.allSettled(
          buyers.map((b) => market.buyNow(listing.id, b.userId)),
        );
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

        // 物品只在一个买家手上，卖家手上没有，总量恰为 1（没被复制也没蒸发）
        const owned = await Promise.all(
          buyers.map((b) => e2e.ownedQty(b.userId, 'skin_tiger')),
        );
        expect(owned.filter((n) => n === 1)).toHaveLength(1);
        expect(owned.reduce((a, b) => a + b, 0)).toBe(1);
        expect(await e2e.ownedQty(seller.userId, 'skin_tiger')).toBe(0);

        const rows = await e2e.db.query<{ status: string }[]>(
          `SELECT status FROM market_listing WHERE id = $1`,
          [listing.id],
        );
        expect(rows[0].status).toBe('sold');
        expect(
          await violationsFor([seller.userId, ...buyers.map((b) => b.userId)]),
        ).toEqual([]);
      });
    }, 30_000);

    /**
     * 多人同时出价：`bid` 在插新出价前先退掉旧最高价，这一步必须被锁串行化，
     * 否则会同时留下两条 active，或把某个落败者的钱冻死。终态应是至多一个 active，
     * 其余出价者的冻结全部归零。
     */
    it('并发出价：至多一个 active 最高价，落败者无冻结泄漏', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const seller = await trader();
        const inst = await giveTradableInstance(seller.userId, 'skin_aurora');
        const listing = await market.list(
          seller.userId,
          { instanceId: inst.instanceId },
          5000,
          'auction',
          uniq(),
        );

        const bidders = await Promise.all(
          Array.from({ length: 6 }, () => trader(20_000)),
        );
        const prices = [5200, 5400, 5600, 5800, 6000, 6200];
        await Promise.allSettled(
          bidders.map((b, i) =>
            market.bid(listing.id, b.userId, prices[i], uniq()),
          ),
        );

        // 先到先得的第一笔一定成功（此时还没有最高价），故 active 恰为 1
        const active = await e2e.db.query<{ n: string }[]>(
          `SELECT count(*) n FROM market_bid WHERE listing_id = $1 AND status = 'active'`,
          [listing.id],
        );
        expect(Number(active[0].n)).toBe(1);

        // 每个出价者的冻结要么为 0（未中/已退），要么恰是自己出的那笔价
        for (const b of bidders) {
          const frozen =
            (await ledger.balances(b.userId))[GAME_COIN]?.frozen ?? 0;
          expect(frozen === 0 || prices.includes(frozen)).toBe(true);
        }
        expect(
          await violationsFor([seller.userId, ...bidders.map((b) => b.userId)]),
        ).toEqual([]);

        // 结算后物品至多归一人，且账目仍守恒
        await market.settleAuction(listing.id);
        const owned = await Promise.all(
          bidders.map((b) => e2e.ownedQty(b.userId, 'skin_aurora')),
        );
        expect(owned.reduce((a, b) => a + b, 0)).toBe(1);
        expect(
          await violationsFor([seller.userId, ...bidders.map((b) => b.userId)]),
        ).toEqual([]);
      });
    }, 30_000);

    /**
     * 撤单与买入同时到达：一件物品只能有一个去向。绝不能出现「卖家撤回拿回物品」
     * 与「买家买到物品」同时成立（一物两份），也不能两个操作都失败把物品冻死在 ESCROW。
     */
    it('撤单与买入并发：物品恰好一个归属，终态与归属一致', async () => {
      await e2e.withConfig(OPEN_MARKET, async () => {
        const seller = await trader();
        const buyer = await trader(2000);
        const inst = await giveTradableInstance(seller.userId, 'skin_calico');
        const listing = await market.list(
          seller.userId,
          { instanceId: inst.instanceId },
          1000,
          'fixed',
          uniq(),
        );

        await Promise.allSettled([
          market.cancel(listing.id, seller.userId, uniq()),
          market.buyNow(listing.id, buyer.userId),
        ]);

        const sellerHas = await e2e.ownedQty(seller.userId, 'skin_calico');
        const buyerHas = await e2e.ownedQty(buyer.userId, 'skin_calico');
        expect(sellerHas + buyerHas).toBe(1);

        const rows = await e2e.db.query<{ status: string }[]>(
          `SELECT status FROM market_listing WHERE id = $1`,
          [listing.id],
        );
        expect(rows[0].status).toBe(buyerHas === 1 ? 'sold' : 'cancelled');
        expect(await violationsFor([seller.userId, buyer.userId])).toEqual([]);
      });
    }, 30_000);

    /**
     * R3 日笔数上限在并发下不被击穿。这是广告日上限那个 bug 的同类：
     * `assertDailyQuota`（读）与 `risk.record`（写）是 check-then-act，
     * 但赠送整段跑在 `withLock('pet:'+发起方)` 里被串行化，因此并发发起
     * `上限 + N` 次也只应有恰好「上限」次成交。
     */
    it('并发赠送打日笔数上限：成功数恰为上限，不超发', async () => {
      await e2e.withConfig(
        {
          ...OPEN_MARKET,
          'market.risk': {
            minAccountAgeDays: 0,
            maxTradesPerDay: 3,
            maxValuePerDay: 10_000_000,
            abnormalPriceRatio: 5,
          },
        },
        async () => {
          const a = await trader();
          const b = await trader();
          await reward.grant(
            a.userId,
            [{ assetCode: 'furn_bowl', count: 10 }],
            {
              reason: 'compensation',
              bizKey: `g:${uniq()}`,
            },
          );

          const results = await Promise.allSettled(
            Array.from({ length: 8 }, () =>
              market.gift(
                a.userId,
                b.userId,
                { assetCode: 'furn_bowl', qty: 1 },
                uniq(),
              ),
            ),
          );

          expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(
            3,
          );
          expect(await e2e.ownedQty(b.userId, 'furn_bowl')).toBe(3);
          expect(await e2e.ownedQty(a.userId, 'furn_bowl')).toBe(7);
          expect(await violationsFor([a.userId, b.userId])).toEqual([]);
        },
      );
    }, 30_000);
  });
});
