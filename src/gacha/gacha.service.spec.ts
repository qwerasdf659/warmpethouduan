import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { LockService } from '../common/lock/lock.service';
import { GameConfigService } from '../config/game-config.service';
import { EconomyService } from '../economy/economy.service';
import { GachaDraw } from '../entities/gacha-draw.entity';
import { GachaState } from '../entities/gacha-state.entity';
import {
  AssetCatalogService,
  AssetView,
} from '../ledger/asset-catalog.service';
import { InventoryService } from '../ledger/inventory.service';
import { Reward, RewardService } from '../ledger/reward.service';
import { GachaEntry, GachaPool } from './gacha.config';
import { GachaService } from './gacha.service';

interface RepoStub {
  find: jest.Mock;
  findOne: jest.Mock;
  save: jest.Mock;
  create: jest.Mock;
  findAndCount: jest.Mock;
  update: jest.Mock;
}

const item = (
  key: string,
  weight: number,
  itemKey: string,
  rare = false,
  qty = 1,
): GachaEntry => ({ key, name: key, weight, itemKey, qty, rare });

const POOL: GachaPool = {
  key: 'daily',
  name: '日常扭蛋',
  pool: 'game',
  cost: 300,
  costTen: 2700,
  pity: 3,
  dupeItemKey: 'cons_snack',
  dupeQty: 2,
  entries: [
    item('snack', 900, 'cons_snack', false, 3),
    item('skin', 100, 'skin_shadow', true),
  ],
};

function repoStub(): RepoStub {
  return {
    find: jest.fn(() => Promise.resolve([])),
    findOne: jest.fn(() => Promise.resolve(null)),
    save: jest.fn((v: unknown) =>
      Promise.resolve({ id: '1', ...(v as object) }),
    ),
    create: jest.fn((v: unknown) => v),
    findAndCount: jest.fn(() => Promise.resolve([[], 0])),
    update: jest.fn(() => Promise.resolve({ affected: 1 })),
  };
}

/** 造一个资产视图。`unique` + 不可交易 = 扭蛋限定款（会触发重复补偿）。 */
function assetOf(
  code: string,
  kind: AssetView['kind'],
  tradable = false,
): AssetView {
  return {
    code,
    kind,
    itemType: kind === 'unique' ? 'skin' : 'consumable',
    name: code,
    slot: null,
    price: 100,
    priceAsset: 'game_coin',
    comfort: 0,
    gridW: 1,
    gridH: 1,
    tradable,
    redeemable: false,
    mintLimit: null,
    mintedCount: 0,
    enabled: true,
    sortOrder: 0,
    meta: {},
  };
}

/** 取某次调用的第 n 个入参，绕开 `jest.Mock.mock.calls` 的 any[][] 静态类型。 */
function argOf<T>(mock: jest.Mock, index = 0, call = 0): T {
  return (mock.mock.calls as unknown[][])[call][index] as T;
}

describe('GachaService', () => {
  let draws: RepoStub;
  let states: RepoStub;
  let economy: { getWallet: jest.Mock };
  let reward: { exchange: jest.Mock };
  let catalog: { getManyByCode: jest.Mock };
  let inventory: { ownedMap: jest.Mock };
  let svc: GachaService;
  let pools: GachaPool[];
  /** code -> 资产视图。默认两个产出物都是扭蛋限定款/消耗品。 */
  let assets: Map<string, AssetView>;

  beforeEach(() => {
    draws = repoStub();
    states = repoStub();
    economy = {
      getWallet: jest.fn(() =>
        Promise.resolve({
          gameCoin: 100_000,
          marketingPoint: 0,
          gameCoinFrozen: 0,
          marketingPointFrozen: 0,
        }),
      ),
    };
    reward = {
      exchange: jest.fn(() =>
        Promise.resolve({
          txnId: 'T1',
          bizId: 'u1:gacha:draw:b1',
          balances: {},
          minted: [],
          duplicated: false,
        }),
      ),
    };
    assets = new Map([
      ['cons_snack', assetOf('cons_snack', 'stackable')],
      ['skin_shadow', assetOf('skin_shadow', 'unique')],
      ['furn_rug', assetOf('furn_rug', 'stackable', true)],
      ['skin_aurora', assetOf('skin_aurora', 'unique', true)],
    ]);
    catalog = {
      getManyByCode: jest.fn((codes: string[]) =>
        Promise.resolve(
          new Map(
            codes
              .filter((c) => assets.has(c))
              .map((c) => [c, assets.get(c) as AssetView]),
          ),
        ),
      ),
    };
    inventory = {
      ownedMap: jest.fn(() => Promise.resolve(new Map<string, number>())),
    };
    pools = [POOL];

    const config = {
      get: () => Promise.resolve(pools),
    } as unknown as GameConfigService;
    const lock = {
      withLock: <T>(_k: string, fn: () => Promise<T>) => fn(),
    } as unknown as LockService;

    svc = new GachaService(
      draws as unknown as Repository<GachaDraw>,
      states as unknown as Repository<GachaState>,
      economy as unknown as EconomyService,
      reward as unknown as RewardService,
      catalog as unknown as AssetCatalogService,
      inventory as unknown as InventoryService,
      config,
      lock,
    );
  });

  describe('入参与奖池', () => {
    it('只接受 1 抽或 10 连', async () => {
      await expect(svc.draw('u1', 'daily', 5, 'b1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(reward.exchange).not.toHaveBeenCalled();
    });

    it('奖池不存在时拒绝且不扣费', async () => {
      await expect(svc.draw('u1', 'nope', 1, 'b1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(reward.exchange).not.toHaveBeenCalled();
    });

    it('十连按 costTen 计价而非单抽×10', async () => {
      await svc.draw('u1', 'daily', 10, 'b1');
      const costs = argOf<Reward[]>(reward.exchange, 1);
      expect(costs).toEqual([{ assetCode: 'game_coin', count: 2700 }]);
    });

    /**
     * 扣费与发奖合成一张凭证之后，扣费必然发生在「掷出 + 落库」之后。
     * 因此余额预检必须前置 —— 否则余额不足的玩家会留下一行 delivered=false
     * 的抽奖记录并推进保底计数，等于免费占用了一次掷出结果。
     */
    it('余额不足时在掷出之前就拒绝，不落抽奖记录也不推进保底', async () => {
      economy.getWallet.mockResolvedValue({
        gameCoin: 299,
        marketingPoint: 0,
        gameCoinFrozen: 0,
        marketingPointFrozen: 0,
      });

      await expect(svc.draw('u1', 'daily', 1, 'b1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(draws.save).not.toHaveBeenCalled();
      expect(states.save).not.toHaveBeenCalled();
      expect(reward.exchange).not.toHaveBeenCalled();
    });
  });

  describe('幂等：重试不重掷', () => {
    const drawRow = (delivered: boolean) => ({
      id: '9',
      userId: 'u1',
      poolKey: 'daily',
      bizId: 'b1',
      times: 1,
      cost: 300,
      pool: 'game' as const,
      prizes: [
        {
          entryKey: 'skin',
          name: 'skin',
          itemKey: 'skin_shadow',
          qty: 1,
          rare: true,
          converted: false,
        },
      ],
      delivered,
    });

    it('同一 bizId 已抽过则回放原结果，不再扣费也不再掷', async () => {
      draws.findOne.mockResolvedValue(drawRow(true));

      const res = await svc.draw('u1', 'daily', 1, 'b1');

      expect(res.duplicated).toBe(true);
      expect(res.prizes[0].entryKey).toBe('skin');
      expect(reward.exchange).not.toHaveBeenCalled();
      expect(draws.save).not.toHaveBeenCalled();
      expect(states.save).not.toHaveBeenCalled();
    });

    it('已落库但未兑现（delivered=false）时按原样补发，仍不重掷', async () => {
      draws.findOne.mockResolvedValue(drawRow(false));

      const res = await svc.draw('u1', 'daily', 1, 'b1');

      expect(res.duplicated).toBe(true);
      expect(reward.exchange).toHaveBeenCalledTimes(1);
      expect(draws.update).toHaveBeenCalledWith(
        { id: '9' },
        { delivered: true },
      );
      // 补发不等于再抽一次
      expect(draws.save).not.toHaveBeenCalled();
    });

    it('先落库（delivered=false）再兑现，顺序不能反', async () => {
      const order: string[] = [];
      draws.save.mockImplementation((v: { delivered: boolean }) => {
        order.push(`save:delivered=${String(v.delivered)}`);
        return Promise.resolve({ id: '1', ...v });
      });
      reward.exchange.mockImplementation(() => {
        order.push('exchange');
        return Promise.resolve({
          txnId: 'T1',
          bizId: 'x',
          balances: {},
          minted: [],
          duplicated: false,
        });
      });
      draws.update.mockImplementation(() => {
        order.push('markDelivered');
        return Promise.resolve({ affected: 1 });
      });

      await svc.draw('u1', 'daily', 1, 'b1');

      expect(order).toEqual([
        'save:delivered=false',
        'exchange',
        'markDelivered',
      ]);
    });
  });

  describe('保底', () => {
    it('攒够 pity-1 后下一抽强制出稀有并把计数归零', async () => {
      states.findOne.mockResolvedValue({
        id: '1',
        userId: 'u1',
        poolKey: 'daily',
        pity: 2,
        totalDraws: 2,
      });

      const res = await svc.draw('u1', 'daily', 1, 'b1');

      expect(res.prizes[0].rare).toBe(true);
      const saved = argOf<{ pity: number; totalDraws: number }>(states.save);
      expect(saved.pity).toBe(0);
      expect(saved.totalDraws).toBe(3);
    });

    it('十连内触发保底后计数重新累计，不会一次连抽出两个稀有', async () => {
      states.findOne.mockResolvedValue({
        id: '1',
        userId: 'u1',
        poolKey: 'daily',
        pity: 2,
        totalDraws: 2,
      });
      // 让随机永远指向第一档（非稀有），稀有只能来自保底
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const res = await svc.draw('u1', 'daily', 10, 'b1');

      // pity=3：第 1 抽保底出稀有，之后每 3 抽一次 → 第 1、4、7、10 抽
      expect(res.prizes.filter((p) => p.rare)).toHaveLength(4);
      expect(res.pity).toBe(0);
      jest.spyOn(Math, 'random').mockRestore();
    });

    it('pity=0 表示不保底', async () => {
      pools = [{ ...POOL, pity: 0 }];
      states.findOne.mockResolvedValue({
        id: '1',
        userId: 'u1',
        poolKey: 'daily',
        pity: 99,
        totalDraws: 99,
      });
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const res = await svc.draw('u1', 'daily', 1, 'b1');

      expect(res.prizes[0].rare).toBe(false);
      expect(res.pity).toBe(100);
      jest.spyOn(Math, 'random').mockRestore();
    });
  });

  /**
   * 折算口径在重构后收窄了：唯一物品实例化之后，**可交易**皮肤的第二份是有价值的
   * 资产（能挂到市场卖掉），不该折算。真正零价值的只剩「重复的、且不可交易的」——
   * 也就是扭蛋限定款本身。
   */
  describe('重复收藏品折算', () => {
    beforeEach(() => {
      pools = [{ ...POOL, pity: 0, entries: [item('skin', 1, 'skin_shadow')] }];
    });

    it('已拥有的不可交易皮肤折算成补偿道具', async () => {
      inventory.ownedMap.mockResolvedValue(new Map([['skin_shadow', 1]]));

      const res = await svc.draw('u1', 'daily', 1, 'b1');

      expect(res.prizes[0].converted).toBe(true);
      expect(res.prizes[0].itemKey).toBe('cons_snack');
      expect(res.prizes[0].qty).toBe(2);
    });

    it('十连里同款限定皮肤第二件起也折算', async () => {
      const res = await svc.draw('u1', 'daily', 10, 'b1');
      expect(res.prizes.filter((p) => p.converted)).toHaveLength(9);
    });

    it('可交易的重复皮肤不折算：第二份能挂到市场卖，是正当产出', async () => {
      pools = [{ ...POOL, pity: 0, entries: [item('a', 1, 'skin_aurora')] }];
      inventory.ownedMap.mockResolvedValue(new Map([['skin_aurora', 1]]));

      const res = await svc.draw('u1', 'daily', 1, 'b1');

      expect(res.prizes[0].converted).toBe(false);
      expect(res.prizes[0].itemKey).toBe('skin_aurora');
    });

    it('可堆叠资产不折算（本来就是可叠加的）', async () => {
      pools = [{ ...POOL, pity: 0, entries: [item('s', 1, 'cons_snack')] }];
      inventory.ownedMap.mockResolvedValue(new Map([['cons_snack', 5]]));

      const res = await svc.draw('u1', 'daily', 1, 'b1');

      expect(res.prizes[0].converted).toBe(false);
      expect(res.prizes[0].itemKey).toBe('cons_snack');
    });

    it('配置指向不存在的资产时折成补偿道具，而不是让玩家白花钱', async () => {
      pools = [{ ...POOL, pity: 0, entries: [item('x', 1, 'nope')] }];

      const res = await svc.draw('u1', 'daily', 1, 'b1');

      expect(res.prizes[0].converted).toBe(true);
      expect(res.prizes[0].itemKey).toBe('cons_snack');
    });
  });

  describe('兑现', () => {
    /**
     * G2 的修复点。旧实现是「扣费」「落库」「逐个发货」三次独立写入，
     * 中间失败就是扣了钱没给东西。现在是一张凭证。
     */
    it('扣费与全部产出合成一次 exchange 调用', async () => {
      pools = [
        { ...POOL, pity: 0, entries: [item('s', 1, 'cons_snack', false, 3)] },
      ];

      await svc.draw('u1', 'daily', 10, 'b1');

      expect(reward.exchange).toHaveBeenCalledTimes(1);
      const costs = argOf<Reward[]>(reward.exchange, 1);
      const rewards = argOf<Reward[]>(reward.exchange, 2);
      expect(costs).toEqual([{ assetCode: 'game_coin', count: 2700 }]);
      // 十抽各 3 份；合并成一条分录由 RewardService 负责，这里只看清单完整
      expect(rewards).toHaveLength(10);
      expect(rewards.every((r) => r.assetCode === 'cons_snack')).toBe(true);
    });

    it('幂等键由抽奖 bizId 派生，重放会命中 asset_txn 唯一约束', async () => {
      await svc.draw('u1', 'daily', 1, 'b1');
      const ctx = argOf<{ bizKey: string; reason: string }>(reward.exchange, 3);
      expect(ctx.bizKey).toBe('gacha:draw:b1');
      expect(ctx.reason).toBe('gacha');
    });
  });

  describe('list', () => {
    it('返回概率公示与我的保底剩余抽数', async () => {
      states.find.mockResolvedValue([
        { poolKey: 'daily', pity: 1, totalDraws: 1 },
      ]);

      const res = await svc.list('u1');

      expect(res.pools[0].pityLeft).toBe(2);
      expect(res.pools[0].odds).toEqual([
        { key: 'snack', name: 'snack', rare: false, percent: 90 },
        { key: 'skin', name: 'skin', rare: true, percent: 10 },
      ]);
    });

    it('不保底的池 pityLeft 为 null', async () => {
      pools = [{ ...POOL, pity: 0 }];
      const res = await svc.list('u1');
      expect(res.pools[0].pityLeft).toBeNull();
    });
  });
});
