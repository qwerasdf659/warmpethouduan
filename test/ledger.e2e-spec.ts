import { ReconcileService } from '../src/economy/reconcile.service';
import { ExpireService } from '../src/ledger/expire.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { RewardService } from '../src/ledger/reward.service';
import { AccountService } from '../src/ledger/account.service';
import { GAME_COIN, MARKETING_POINT } from '../src/ledger/ledger.types';
import { E2eApp } from './helpers/e2e-app';

/**
 * 账本核心（期 1）连真库验证。
 *
 * 这里测的都是**只有真 Postgres 才能验的东西**：分区表写入、
 * `NULLS NOT DISTINCT` 批次归并、FIFO 跨批次分摊、限量编号的原子分配、
 * 条件 UPDATE 的 0 行语义、以及 11 项对账不变量的 SQL 本身是否成立。
 * 用假 EntityManager 测这些只会验证「我写的字符串等于我写的字符串」。
 */
describe('账本核心 (e2e, 连真库)', () => {
  let e2e: E2eApp;
  let ledger: LedgerService;
  let reward: RewardService;
  let accounts: AccountService;
  let reconcile: ReconcileService;
  let expire: ExpireService;

  beforeAll(async () => {
    e2e = await E2eApp.boot();
    ledger = e2e.app.get(LedgerService);
    reward = e2e.app.get(RewardService);
    accounts = e2e.app.get(AccountService);
    reconcile = e2e.app.get(ReconcileService);
    expire = e2e.app.get(ExpireService);
  }, 60_000);

  afterAll(async () => {
    await e2e.teardown();
  }, 60_000);

  const uniq = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  /**
   * 从一条违反样本里取账户 id。
   *
   * 样本是 `Record<string, unknown>`（各条不变量的列不一样），而只有一部分不变量
   * 会报出 `account_id`（比如不变量 8/11 报的是资产 code）。这里显式判类型，
   * 不是为了过 lint —— 直接 `String(unknown)` 在对象上会得到 `[object Object]`，
   * 于是「本用例无关的违反」会被静默算进来。
   */
  function accountIdOf(sample: Record<string, unknown>): string | null {
    const raw = sample.account_id;
    if (typeof raw === 'string') return raw;
    if (typeof raw === 'number' || typeof raw === 'bigint') return String(raw);
    return null;
  }

  /** 玩家的批次行（按 FIFO 顺序）。 */
  async function lotsOf(userId: string, assetCode: string) {
    const accountId = await accounts.peek({ userId });
    return e2e.db.query<
      { remaining: string; frozen: string; expires_at: Date | null }[]
    >(
      `SELECT remaining, frozen, expires_at FROM asset_lot
        WHERE account_id = $1 AND asset_code = $2
        ORDER BY expires_at NULLS LAST, id`,
      [accountId, assetCode],
    );
  }

  /**
   * 把某资产的全部批次重排成给定的几桶，**总量必须不变**。
   *
   * 用于构造「多个到期日」的场景：真实路径下到期日由 `expire_days` 按自然月末推导，
   * 一次 e2e 里发几次都会归并成同一桶。总量不变是硬要求 —— 否则余额、分录、
   * 批次三层立刻不一致，对账的不变量 2/3/9 会把测试数据自己报成异常。
   */
  async function splitLots(
    userId: string,
    assetCode: string,
    buckets: { remaining: number; expiresInDays: number | null }[],
  ) {
    const accountId = await accounts.resolve({ userId });
    await e2e.db.query(
      `DELETE FROM asset_lot WHERE account_id = $1 AND asset_code = $2`,
      [accountId, assetCode],
    );
    for (const b of buckets) {
      await e2e.db.query(
        `INSERT INTO asset_lot (account_id, asset_code, remaining, issued_total, expires_at)
         VALUES ($1, $2, $3, $3,
                 CASE WHEN $4::int IS NULL THEN NULL
                      ELSE now() + ($4::int || ' days')::interval END)`,
        [accountId, assetCode, b.remaining, b.expiresInDays],
      );
    }
  }

  async function entryCountOf(userId: string, assetCode: string) {
    const accountId = await accounts.peek({ userId });
    const rows = await e2e.db.query<{ n: string }[]>(
      `SELECT count(*) n FROM asset_entry WHERE account_id = $1 AND asset_code = $2`,
      [accountId, assetCode],
    );
    return Number(rows[0].n);
  }

  describe('多资产原子性（缺口 G2）', () => {
    it('扣币 + 发多种奖品是一张凭证，余额与持有量同时生效', async () => {
      const p = await e2e.createPlayer();
      await e2e.fundWallet(p.userId, { game: 1000 });

      const res = await reward.exchange(
        p.userId,
        [{ assetCode: GAME_COIN, count: 300 }],
        [
          { assetCode: 'furn_sofa', count: 1 },
          { assetCode: 'cons_snack', count: 3 },
        ],
        { reason: 'gacha', bizKey: `gacha:${uniq()}` },
      );

      expect(res.duplicated).toBe(false);
      expect(await e2e.walletOf(p.userId)).toMatchObject({ gameCoin: 700 });
      expect(await e2e.ownedQty(p.userId, 'furn_sofa')).toBe(1);
      expect(await e2e.ownedQty(p.userId, 'cons_snack')).toBe(3);

      // 三条分录同属一张凭证
      const rows = await e2e.db.query<{ n: string }[]>(
        `SELECT count(*) n FROM asset_entry WHERE txn_id = $1`,
        [res.txnId],
      );
      expect(Number(rows[0].n)).toBe(3);
    });

    /**
     * 旧模型下这里会「扣了钱不给东西」：扣费与入库是两次独立写入。
     * 现在余额不足由条件 UPDATE 拦住并整体回滚，一条分录都不该留下。
     */
    it('余额不足时整体回滚，不产生任何分录', async () => {
      const p = await e2e.createPlayer();
      await e2e.fundWallet(p.userId, { game: 100 });

      await expect(
        reward.exchange(
          p.userId,
          [{ assetCode: GAME_COIN, count: 500 }],
          [{ assetCode: 'furn_sofa', count: 1 }],
          { reason: 'purchase', bizKey: `buy:${uniq()}` },
        ),
      ).rejects.toThrow();

      expect(await e2e.walletOf(p.userId)).toMatchObject({ gameCoin: 100 });
      expect(await e2e.ownedQty(p.userId, 'furn_sofa')).toBe(0);
      // 只剩 fundWallet 那一条发放分录
      expect(await entryCountOf(p.userId, GAME_COIN)).toBe(1);
    });
  });

  describe('幂等（收敛到 asset_txn.biz_id）', () => {
    it('同一 bizKey 重复过账：第二次是回放，余额只变一次', async () => {
      const p = await e2e.createPlayer();
      const bizKey = `daily:${uniq()}`;

      const first = await reward.grant(
        p.userId,
        [{ assetCode: GAME_COIN, count: 100 }],
        { reason: 'daily', bizKey },
      );
      const second = await reward.grant(
        p.userId,
        [{ assetCode: GAME_COIN, count: 100 }],
        { reason: 'daily', bizKey },
      );

      expect(first.duplicated).toBe(false);
      expect(second.duplicated).toBe(true);
      expect(second.txnId).toBe(first.txnId);
      expect(await e2e.walletOf(p.userId)).toMatchObject({ gameCoin: 100 });
      expect(await entryCountOf(p.userId, GAME_COIN)).toBe(1);
    });

    /**
     * 幂等键必须自带用户区分。`biz_id` 是全局唯一的，若不加 `u{userId}:` 前缀，
     * 两个玩家提交同样的客户端 UUID 会互相把对方的操作「回放」掉。
     */
    it('两个玩家用同一个客户端 UUID 各自都能到账', async () => {
      const a = await e2e.createPlayer();
      const b = await e2e.createPlayer();
      const shared = `interact:${uniq()}`;

      const ra = await reward.grant(
        a.userId,
        [{ assetCode: GAME_COIN, count: 12 }],
        { reason: 'interact', bizKey: shared },
      );
      const rb = await reward.grant(
        b.userId,
        [{ assetCode: GAME_COIN, count: 12 }],
        { reason: 'interact', bizKey: shared },
      );

      expect(ra.duplicated).toBe(false);
      expect(rb.duplicated).toBe(false);
      expect(ra.txnId).not.toBe(rb.txnId);
      expect(await e2e.walletOf(a.userId)).toMatchObject({ gameCoin: 12 });
      expect(await e2e.walletOf(b.userId)).toMatchObject({ gameCoin: 12 });
    });
  });

  /**
   * 批次是余额的分桶实现。归并设计的承重点是 `NULLS NOT DISTINCT` 唯一索引 ——
   * PG15 之前 `NULL` 互不相等，每次发行都会新建一行，`game_coin` 会长出成千上万个批次。
   */
  describe('批次（lot）与 FIFO', () => {
    it('永不过期的资产连续发行归并为单行', async () => {
      const p = await e2e.createPlayer();
      for (const n of [100, 12, 8]) {
        await reward.grant(p.userId, [{ assetCode: GAME_COIN, count: n }], {
          reason: 'interact',
          bizKey: `i:${uniq()}`,
        });
      }

      const lots = await lotsOf(p.userId, GAME_COIN);
      expect(lots).toHaveLength(1);
      expect(Number(lots[0].remaining)).toBe(120);
      expect(lots[0].expires_at).toBeNull();
    });

    it('可堆叠道具也走批次，且与余额快照一致', async () => {
      const p = await e2e.createPlayer();
      await reward.grant(p.userId, [{ assetCode: 'cons_snack', count: 5 }], {
        reason: 'daily',
        bizKey: `s:${uniq()}`,
      });

      const lots = await lotsOf(p.userId, 'cons_snack');
      expect(lots).toHaveLength(1);
      expect(Number(lots[0].remaining)).toBe(5);
      expect(await e2e.ownedQty(p.userId, 'cons_snack')).toBe(5);
    });

    /**
     * FIFO 的意义：先扣最早到期的，永不过期的排最后。否则玩家的积分会
     * 「先花掉永久的、留着快过期的」，然后眼看着它过期。
     */
    it('跨批次消耗按到期日升序分摊，永不过期的排最后', async () => {
      const p = await e2e.createPlayer();

      // 先按正常路径发放，让余额与分录建立起来
      await reward.grant(
        p.userId,
        [{ assetCode: MARKETING_POINT, count: 30 }],
        { reason: 'promo', bizKey: `promo:${uniq()}` },
      );
      // 再把那一桶**拆成**三桶（到期日不同，总量不变）。
      // 只能这样造：到期日由 expire_days 推导，且按自然月末归并，
      // 单次 e2e 跑不出「上个月发的」那一桶。拆分保持总量不变，
      // 因此余额、分录、批次三层依然一致（不会踩对账不变量 2/3/9）。
      await splitLots(p.userId, MARKETING_POINT, [
        { remaining: 10, expiresInDays: 1 },
        { remaining: 10, expiresInDays: 5 },
        { remaining: 10, expiresInDays: null },
      ]);

      // 花 15：应该吃掉第一桶(10) + 第二桶的 5，永久桶不动
      await reward.charge(
        p.userId,
        [{ assetCode: MARKETING_POINT, count: 15 }],
        { reason: 'exchange', bizKey: `x:${uniq()}` },
      );

      const lots = await lotsOf(p.userId, MARKETING_POINT);
      expect(lots.map((l) => Number(l.remaining))).toEqual([0, 5, 10]);
      expect(lots[2].expires_at).toBeNull();
      // 余额与批次聚合仍然对得上
      expect(await e2e.walletOf(p.userId)).toMatchObject({
        marketingPoint: 15,
      });
    });
  });

  /**
   * 限量编号是交易市场的价值锚（「第 7/100 件」产生收藏溢价）。
   * 超发的防线是 `ck_asset_mint_limit` —— 结构性不可能，而非靠应用层记得检查。
   */
  describe('唯一物品与限量编号', () => {
    const LIMITED = `skin_e2e_${Date.now()}`;

    beforeAll(async () => {
      await e2e.db.query(
        `INSERT INTO asset_def (code, kind, name, tradable, mint_limit, sort_order, meta)
         VALUES ($1, 'unique', 'e2e 限量皮肤', true, 2, 999,
                 '{"itemType":"skin","slot":"body","price":100,"priceAsset":"game_coin"}')`,
        [LIMITED],
      );
      e2e.app.get(LedgerService).invalidateDefCache();
    });

    afterAll(async () => {
      // 顺序即外键顺序：实例分录 → 实例 → 定义。
      // 直接删定义会被 item_instance_asset_code_fkey 拦住 —— 这正是
      // `AdminItemsService.remove` 拒绝删除「已有持有记录的资产」的原因。
      await e2e.db.query(
        `DELETE FROM item_instance_entry
          WHERE instance_id IN (SELECT id FROM item_instance WHERE asset_code = $1)`,
        [LIMITED],
      );
      await e2e.db.query(`DELETE FROM item_instance WHERE asset_code = $1`, [
        LIMITED,
      ]);
      await e2e.db.query(`DELETE FROM asset_def WHERE code = $1`, [LIMITED]);
    });

    it('铸造分配连续编号，售罄后拒绝且不超发', async () => {
      const a = await e2e.createPlayer();
      const b = await e2e.createPlayer();
      const c = await e2e.createPlayer();

      const r1 = await reward.grant(
        a.userId,
        [{ assetCode: LIMITED, count: 1 }],
        {
          reason: 'compensation',
          bizKey: `m:${uniq()}`,
        },
      );
      const r2 = await reward.grant(
        b.userId,
        [{ assetCode: LIMITED, count: 1 }],
        {
          reason: 'compensation',
          bizKey: `m:${uniq()}`,
        },
      );

      expect(r1.minted[0].serial).toBe(1);
      expect(r2.minted[0].serial).toBe(2);

      // 第三件必须被拒：mint_limit = 2
      await expect(
        reward.grant(c.userId, [{ assetCode: LIMITED, count: 1 }], {
          reason: 'compensation',
          bizKey: `m:${uniq()}`,
        }),
      ).rejects.toThrow(/售罄/);

      const rows = await e2e.db.query<{ minted_count: number }[]>(
        `SELECT minted_count FROM asset_def WHERE code = $1`,
        [LIMITED],
      );
      expect(rows[0].minted_count).toBe(2);
    });

    it('不限量的唯一物品不落 serial（编号只在有上限时才有含义）', async () => {
      const p = await e2e.createPlayer();
      const res = await reward.grant(
        p.userId,
        [{ assetCode: 'skin_tiger', count: 1 }],
        { reason: 'compensation', bizKey: `m:${uniq()}` },
      );
      expect(res.minted[0].serial).toBeNull();
    });

    it('唯一物品的持有量按实例条数，且不能按数量扣减', async () => {
      const p = await e2e.createPlayer();
      await reward.grant(p.userId, [{ assetCode: 'skin_snow', count: 2 }], {
        reason: 'compensation',
        bizKey: `m:${uniq()}`,
      });

      expect(await e2e.ownedQty(p.userId, 'skin_snow')).toBe(2);
      expect(await e2e.instancesOf(p.userId, 'skin_snow')).toHaveLength(2);

      await expect(
        reward.charge(p.userId, [{ assetCode: 'skin_snow', count: 1 }], {
          reason: 'purchase',
          bizKey: `c:${uniq()}`,
        }),
      ).rejects.toThrow(/唯一物品/);
    });
  });

  describe('冻结与转移', () => {
    it('冻结把可用转为冻结，总量不变；解冻反向', async () => {
      const p = await e2e.createPlayer();
      await e2e.fundWallet(p.userId, { game: 500 });

      await ledger.post({
        kind: 'freeze',
        reason: 'market_list',
        scope: 'mkt',
        bizKey: `f:${uniq()}`,
        legs: [
          {
            account: { userId: p.userId },
            assetCode: GAME_COIN,
            delta: -200,
            frozenDelta: 200,
          },
        ],
      });

      let w = await ledger.balances(p.userId);
      expect(w[GAME_COIN]).toEqual({ available: 300, frozen: 200 });
      let lots = await lotsOf(p.userId, GAME_COIN);
      expect(Number(lots[0].remaining)).toBe(300);
      expect(Number(lots[0].frozen)).toBe(200);

      await ledger.post({
        kind: 'freeze',
        reason: 'market_unlist',
        scope: 'mkt',
        bizKey: `u:${uniq()}`,
        legs: [
          {
            account: { userId: p.userId },
            assetCode: GAME_COIN,
            delta: 200,
            frozenDelta: -200,
          },
        ],
      });

      w = await ledger.balances(p.userId);
      expect(w[GAME_COIN]).toEqual({ available: 500, frozen: 0 });
      lots = await lotsOf(p.userId, GAME_COIN);
      expect(Number(lots[0].frozen)).toBe(0);
    });

    it('冻结额度不足时拒绝（不能冻结超过可用余额）', async () => {
      const p = await e2e.createPlayer();
      await e2e.fundWallet(p.userId, { game: 100 });

      await expect(
        ledger.post({
          kind: 'freeze',
          reason: 'market_list',
          scope: 'mkt',
          bizKey: `f:${uniq()}`,
          legs: [
            {
              account: { userId: p.userId },
              assetCode: GAME_COIN,
              delta: -500,
              frozenDelta: 500,
            },
          ],
        }),
      ).rejects.toThrow();
    });

    it('transfer 平衡时通过，不平衡时拒绝且整体回滚', async () => {
      const a = await e2e.createPlayer();
      const b = await e2e.createPlayer();
      await e2e.fundWallet(a.userId, { game: 1000 });

      await ledger.post({
        kind: 'transfer',
        reason: 'gift',
        scope: 'mkt',
        bizKey: `t:${uniq()}`,
        legs: [
          { account: { userId: a.userId }, assetCode: GAME_COIN, delta: -400 },
          { account: { userId: b.userId }, assetCode: GAME_COIN, delta: 400 },
        ],
      });
      expect(await e2e.walletOf(a.userId)).toMatchObject({ gameCoin: 600 });
      expect(await e2e.walletOf(b.userId)).toMatchObject({ gameCoin: 400 });

      await expect(
        ledger.post({
          kind: 'transfer',
          reason: 'gift',
          scope: 'mkt',
          bizKey: `t:${uniq()}`,
          legs: [
            {
              account: { userId: a.userId },
              assetCode: GAME_COIN,
              delta: -100,
            },
            { account: { userId: b.userId }, assetCode: GAME_COIN, delta: 50 },
          ],
        }),
      ).rejects.toThrow(/不平衡/);
      // 拒绝之后余额一分未动
      expect(await e2e.walletOf(a.userId)).toMatchObject({ gameCoin: 600 });
    });

    it('唯一物品转移写成对 ±1 分录，owner 随之改变', async () => {
      const a = await e2e.createPlayer();
      const b = await e2e.createPlayer();
      await reward.grant(a.userId, [{ assetCode: 'acc_bell', count: 1 }], {
        reason: 'compensation',
        bizKey: `m:${uniq()}`,
      });
      const [inst] = await e2e.instancesOf(a.userId, 'acc_bell');

      const res = await ledger.post({
        kind: 'transfer',
        reason: 'gift',
        scope: 'mkt',
        bizKey: `t:${uniq()}`,
        instanceMoves: [
          {
            instanceId: inst.instanceId,
            from: { userId: a.userId },
            to: { userId: b.userId },
          },
        ],
      });

      expect(await e2e.ownedQty(a.userId, 'acc_bell')).toBe(0);
      expect(await e2e.ownedQty(b.userId, 'acc_bell')).toBe(1);

      const entries = await e2e.db.query<{ delta: number }[]>(
        `SELECT delta FROM item_instance_entry WHERE txn_id = $1 ORDER BY delta`,
        [res.txnId],
      );
      expect(entries.map((r) => r.delta)).toEqual([-1, 1]);
    });

    it('转移不属于自己的实例时拒绝', async () => {
      const a = await e2e.createPlayer();
      const b = await e2e.createPlayer();
      await reward.grant(a.userId, [{ assetCode: 'acc_bow', count: 1 }], {
        reason: 'compensation',
        bizKey: `m:${uniq()}`,
      });
      const [inst] = await e2e.instancesOf(a.userId, 'acc_bow');

      await expect(
        ledger.post({
          kind: 'transfer',
          reason: 'gift',
          scope: 'mkt',
          bizKey: `t:${uniq()}`,
          instanceMoves: [
            {
              instanceId: inst.instanceId,
              // b 并不持有它
              from: { userId: b.userId },
              to: { userId: a.userId },
            },
          ],
        }),
      ).rejects.toThrow();
    });
  });

  describe('封禁兜底', () => {
    it('封禁账号动不了资产，但后台补偿仍可结算', async () => {
      const p = await e2e.createPlayer({ status: 'banned' });

      await expect(
        reward.grant(p.userId, [{ assetCode: GAME_COIN, count: 10 }], {
          reason: 'interact',
          bizKey: `i:${uniq()}`,
        }),
      ).rejects.toThrow(/封禁/);

      // compensation 在豁免名单里：封号后仍要能结算补偿、追回违规收益
      await expect(
        reward.grant(p.userId, [{ assetCode: GAME_COIN, count: 10 }], {
          reason: 'compensation',
          bizKey: `c:${uniq()}`,
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('冲正（唯一的账务修复手段）', () => {
    it('冲正生成反向分录，余额回到原状', async () => {
      const p = await e2e.createPlayer();
      const granted = await reward.grant(
        p.userId,
        [{ assetCode: GAME_COIN, count: 250 }],
        { reason: 'admin_grant', bizKey: `g:${uniq()}` },
      );
      expect(await e2e.walletOf(p.userId)).toMatchObject({ gameCoin: 250 });

      await ledger.reverse(granted.txnId, uniq());
      expect(await e2e.walletOf(p.userId)).toMatchObject({ gameCoin: 0 });
    });

    it('同一凭证不可重复冲正', async () => {
      const p = await e2e.createPlayer();
      const granted = await reward.grant(
        p.userId,
        [{ assetCode: GAME_COIN, count: 100 }],
        { reason: 'admin_grant', bizKey: `g:${uniq()}` },
      );
      await ledger.reverse(granted.txnId, uniq());
      await expect(ledger.reverse(granted.txnId, uniq())).rejects.toThrow(
        /已冲正/,
      );
    });

    /**
     * 铸造凭证没有对手方，冲正它会让实例的分录求和变成 0 而 state 仍是 held ——
     * 也就是「物品凭空消失」。销毁必须走回收流程（写 burn 分录 + 落 burned 状态）。
     */
    it('铸造凭证不可冲正，避免破坏实例守恒', async () => {
      const p = await e2e.createPlayer();
      const minted = await reward.grant(
        p.userId,
        [{ assetCode: 'acc_scarf', count: 1 }],
        { reason: 'compensation', bizKey: `m:${uniq()}` },
      );
      await expect(ledger.reverse(minted.txnId, uniq())).rejects.toThrow(
        /铸造凭证不可冲正/,
      );
    });
  });

  describe('过期批处理', () => {
    it('已到期批次被销毁，余额同步下降，且重跑幂等', async () => {
      const p = await e2e.createPlayer();

      // 正常发放，然后把那一桶的到期日拨到昨天
      await reward.grant(
        p.userId,
        [{ assetCode: MARKETING_POINT, count: 40 }],
        { reason: 'promo', bizKey: `promo:${uniq()}` },
      );
      await splitLots(p.userId, MARKETING_POINT, [
        { remaining: 40, expiresInDays: -1 },
      ]);

      const first = await expire.run();
      expect(first.groups).toBeGreaterThan(0);
      expect(await e2e.walletOf(p.userId)).toMatchObject({ marketingPoint: 0 });

      const lots = await lotsOf(p.userId, MARKETING_POINT);
      expect(lots.every((l) => Number(l.remaining) === 0)).toBe(true);

      // 重跑：没有可过期的批次了，不该二次销毁
      const second = await expire.run();
      expect(second.groups).toBe(0);
      expect(await e2e.walletOf(p.userId)).toMatchObject({ marketingPoint: 0 });
    });
  });

  /**
   * 全套不变量的 SQL 必须能在真实 schema 上跑通。这条用例的价值一半在
   * 「结果为 ok」，另一半在「11 段 SQL 没有一条语法错/字段名错」——
   * 后者在假 DataSource 下永远测不出来。
   */
  describe('对账 11 项不变量', () => {
    /**
     * 从违反样本里挑出与给定账户相关的条目。
     *
     * 断言必须按账户收敛，不能直接看全局 `ok`：对账扫的是**整库**，而开发库里
     * 还有 `seed:dev` 造的玩家和历史调试数据。一旦有人在别处留下一条脏数据，
     * 全局断言就会把本用例报成失败，而失败原因跟本次改动毫无关系。
     */
    function violationsFor(
      report: Awaited<ReturnType<ReconcileService['run']>>,
      accountIds: string[],
    ) {
      const mine = new Set(accountIds);
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

    it('11 段不变量 SQL 都能在真实 schema 上执行（count=-1 表示 SQL 本身出错）', async () => {
      const report = await reconcile.run();
      expect(report.invariants).toHaveLength(11);
      expect(
        report.invariants.filter((i) => i.count === -1).map((i) => i.samples),
      ).toEqual([]);
    });

    it('正常操作后本用例涉及的账户零违反', async () => {
      const a = await e2e.createPlayer();
      const b = await e2e.createPlayer();
      await e2e.fundWallet(a.userId, { game: 2000, marketing: 500 });
      await reward.exchange(
        a.userId,
        [{ assetCode: GAME_COIN, count: 900 }],
        [{ assetCode: 'furn_sofa', count: 1 }],
        { reason: 'purchase', bizKey: `buy:${uniq()}` },
      );
      await reward.grant(a.userId, [{ assetCode: 'skin_calico', count: 1 }], {
        reason: 'compensation',
        bizKey: `m:${uniq()}`,
      });
      await ledger.post({
        kind: 'transfer',
        reason: 'gift',
        scope: 'mkt',
        bizKey: `t:${uniq()}`,
        legs: [
          { account: { userId: a.userId }, assetCode: GAME_COIN, delta: -100 },
          { account: { userId: b.userId }, assetCode: GAME_COIN, delta: 100 },
        ],
      });

      const accountIds = [
        (await accounts.peek({ userId: a.userId })) as string,
        (await accounts.peek({ userId: b.userId })) as string,
      ];
      const report = await reconcile.run();
      expect(violationsFor(report, accountIds)).toEqual([]);
    });

    /**
     * 对账真正要防的是「手工 SQL 改数据不补分录」—— 这是排障、补偿、压测时
     * 最容易做的操作，而数据库层没有任何约束能拦住它。这里就模拟一次。
     */
    it('手工改余额不补分录会被不变量 2 与 9 同时抓到', async () => {
      const p = await e2e.createPlayer();
      await e2e.fundWallet(p.userId, { game: 100 });
      const accountId = (await accounts.peek({
        userId: p.userId,
      })) as string;

      await e2e.db.query(
        `UPDATE asset_balance SET available = available + 999
          WHERE account_id = $1 AND asset_code = $2`,
        [accountId, GAME_COIN],
      );

      const dirty = violationsFor(await reconcile.run(), [accountId]);
      expect(dirty.map((v) => v.id)).toEqual(
        expect.arrayContaining([
          2, // 余额 != 分录累加
          9, // 余额 != 批次聚合
        ]),
      );

      // 还原，免得影响后续用例
      await e2e.db.query(
        `UPDATE asset_balance SET available = available - 999
          WHERE account_id = $1 AND asset_code = $2`,
        [accountId, GAME_COIN],
      );
      expect(violationsFor(await reconcile.run(), [accountId])).toEqual([]);
    });

    it('物化发行日报，并报出可兑资产的待兑付负债', async () => {
      const p = await e2e.createPlayer();
      await e2e.fundWallet(p.userId, { marketing: 300 });

      const report = await reconcile.run();
      const mkt = report.liabilities.find(
        (l) => l.assetCode === MARKETING_POINT,
      );
      expect(mkt).toBeDefined();
      expect(mkt!.outstanding).toBeGreaterThanOrEqual(300);

      const stat = await e2e.db.query<{ issued: string }[]>(
        `SELECT issued FROM asset_daily_stat
          WHERE asset_code = $1 AND reason = 'compensation'
            AND stat_day = (now() AT TIME ZONE 'Asia/Shanghai')::date`,
        [MARKETING_POINT],
      );
      expect(stat.length).toBeGreaterThan(0);
      expect(Number(stat[0].issued)).toBeGreaterThanOrEqual(300);
    });
  });
});
