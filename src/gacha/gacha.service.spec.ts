import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { LockService } from '../common/lock/lock.service';
import { GameConfigService } from '../config/game-config.service';
import { EconomyService } from '../economy/economy.service';
import { GachaDraw } from '../entities/gacha-draw.entity';
import { GachaState } from '../entities/gacha-state.entity';
import { ItemDef } from '../entities/item-def.entity';
import { ItemsService } from '../items/items.service';
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

interface ItemsStub {
  ownedMap: jest.Mock;
  getDefByKey: jest.Mock;
  grantUnlocked: jest.Mock;
}

const coin = (key: string, weight: number, amount: number): GachaEntry => ({
  key,
  name: key,
  weight,
  kind: 'coin',
  amount,
  itemKey: null,
  qty: 0,
  rare: false,
});

const item = (
  key: string,
  weight: number,
  itemKey: string,
  rare = false,
): GachaEntry => ({
  key,
  name: key,
  weight,
  kind: 'item',
  amount: 0,
  itemKey,
  qty: 1,
  rare,
});

const POOL: GachaPool = {
  key: 'daily',
  name: '日常扭蛋',
  pool: 'game',
  cost: 300,
  costTen: 2700,
  pity: 3,
  dupeCoin: 120,
  entries: [coin('c60', 900, 60), item('skin', 100, 'skin_shadow', true)],
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

function defOf(key: string, type: string): ItemDef {
  return { id: `def-${key}`, key, type } as ItemDef;
}

/**
 * 取某次调用的首个入参。`jest.Mock.mock.calls` 的静态类型是 `any[][]`，
 * 直接下标访问会踩 no-unsafe-member-access，故统一从这里过一道。
 */
function argOf<T>(mock: jest.Mock, call = 0): T {
  return (mock.mock.calls as unknown[][])[call][0] as T;
}

/** 取全部调用的首个入参。 */
function argsOf<T>(mock: jest.Mock): T[] {
  return (mock.mock.calls as unknown[][]).map((c) => c[0] as T);
}

describe('GachaService', () => {
  let draws: RepoStub;
  let states: RepoStub;
  let economy: { apply: jest.Mock; getWallet: jest.Mock };
  let items: ItemsStub;
  let svc: GachaService;
  let pools: GachaPool[];

  beforeEach(() => {
    draws = repoStub();
    states = repoStub();
    economy = {
      apply: jest.fn(() =>
        Promise.resolve({
          wallet: { gameCoin: 1000, marketingPoint: 0 },
          duplicated: false,
        }),
      ),
      getWallet: jest.fn(() =>
        Promise.resolve({ gameCoin: 1000, marketingPoint: 0 }),
      ),
    };
    items = {
      ownedMap: jest.fn(() => Promise.resolve(new Map<string, number>())),
      getDefByKey: jest.fn((key: string) =>
        Promise.resolve(
          defOf(key, key.startsWith('skin') ? 'skin' : 'consumable'),
        ),
      ),
      grantUnlocked: jest.fn(() => Promise.resolve(undefined)),
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
      items as unknown as ItemsService,
      config,
      lock,
    );
  });

  describe('入参与奖池', () => {
    it('只接受 1 抽或 10 连', async () => {
      await expect(svc.draw('u1', 'daily', 5, 'b1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      // 校验要在扣费之前
      expect(economy.apply).not.toHaveBeenCalled();
    });

    it('奖池不存在时拒绝且不扣费', async () => {
      await expect(svc.draw('u1', 'nope', 1, 'b1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(economy.apply).not.toHaveBeenCalled();
    });

    it('十连按 costTen 计价而非单抽×10', async () => {
      await svc.draw('u1', 'daily', 10, 'b1');
      const debit = argOf<{ delta: number }>(economy.apply);
      expect(debit.delta).toBe(-2700);
    });
  });

  describe('幂等：重试不重掷', () => {
    it('同一 bizId 已抽过则回放原结果，不再扣费也不再掷', async () => {
      draws.findOne.mockResolvedValue({
        id: '9',
        userId: 'u1',
        poolKey: 'daily',
        bizId: 'b1',
        times: 1,
        cost: 300,
        pool: 'game',
        prizes: [
          {
            entryKey: 'c60',
            name: 'c60',
            kind: 'coin',
            amount: 60,
            itemKey: null,
            qty: 0,
            rare: false,
            converted: false,
          },
        ],
        delivered: true,
      });

      const res = await svc.draw('u1', 'daily', 1, 'b1');

      expect(res.duplicated).toBe(true);
      expect(res.prizes).toHaveLength(1);
      expect(res.prizes[0].entryKey).toBe('c60');
      expect(economy.apply).not.toHaveBeenCalled();
      expect(draws.save).not.toHaveBeenCalled();
      expect(states.save).not.toHaveBeenCalled();
    });

    it('已落库但未发货（delivered=false）时按原样补发，仍不重掷', async () => {
      draws.findOne.mockResolvedValue({
        id: '9',
        userId: 'u1',
        poolKey: 'daily',
        bizId: 'b1',
        times: 1,
        cost: 300,
        pool: 'game',
        prizes: [
          {
            entryKey: 'skin',
            name: 'skin',
            kind: 'item',
            amount: 0,
            itemKey: 'skin_shadow',
            qty: 1,
            rare: true,
            converted: false,
          },
        ],
        delivered: false,
      });

      const res = await svc.draw('u1', 'daily', 1, 'b1');

      expect(res.duplicated).toBe(true);
      expect(items.grantUnlocked).toHaveBeenCalledWith('u1', 'skin_shadow', 1);
      expect(draws.update).toHaveBeenCalledWith(
        { id: '9' },
        { delivered: true },
      );
      // 补发不等于再抽一次
      expect(draws.save).not.toHaveBeenCalled();
    });

    it('先落库（delivered=false）再发货，顺序不能反', async () => {
      const order: string[] = [];
      draws.save.mockImplementation((v: { delivered: boolean }) => {
        order.push(`save:delivered=${String(v.delivered)}`);
        return Promise.resolve({ id: '1', ...v });
      });
      items.grantUnlocked.mockImplementation(() => {
        order.push('grantUnlocked');
        return Promise.resolve(undefined);
      });
      draws.update.mockImplementation(() => {
        order.push('markDelivered');
        return Promise.resolve({ affected: 1 });
      });

      // 权重 900/100，rand 落在末段才出物品档；这里直接把池换成必出物品
      pools = [{ ...POOL, pity: 0, entries: [item('skin', 1, 'skin_shadow')] }];
      await svc.draw('u1', 'daily', 1, 'b1');

      expect(order).toEqual([
        'save:delivered=false',
        'grantUnlocked',
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
      const rares = res.prizes.filter((p) => p.rare);
      expect(rares).toHaveLength(4);
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

  describe('重复收藏品折算', () => {
    beforeEach(() => {
      pools = [{ ...POOL, pity: 0, entries: [item('skin', 1, 'skin_shadow')] }];
    });

    it('已拥有的皮肤折算成币，不再进背包', async () => {
      items.ownedMap.mockResolvedValue(new Map([['def-skin_shadow', 1]]));

      const res = await svc.draw('u1', 'daily', 1, 'b1');

      expect(res.prizes[0].converted).toBe(true);
      expect(res.prizes[0].kind).toBe('coin');
      expect(res.prizes[0].amount).toBe(120);
      expect(items.grantUnlocked).not.toHaveBeenCalled();
    });

    it('十连里同款皮肤第二件起也折算，背包不会出现 qty=2 的皮肤', async () => {
      const res = await svc.draw('u1', 'daily', 10, 'b1');

      expect(res.prizes.filter((p) => p.converted)).toHaveLength(9);
      expect(items.grantUnlocked).toHaveBeenCalledTimes(1);
    });

    it('家具不折算（可以摆多份）', async () => {
      pools = [{ ...POOL, pity: 0, entries: [item('f', 1, 'furn_rug')] }];
      items.getDefByKey.mockResolvedValue(defOf('furn_rug', 'furniture'));
      items.ownedMap.mockResolvedValue(new Map([['def-furn_rug', 1]]));

      const res = await svc.draw('u1', 'daily', 1, 'b1');

      expect(res.prizes[0].converted).toBe(false);
      expect(items.grantUnlocked).toHaveBeenCalledWith('u1', 'furn_rug', 1);
    });

    it('消耗品不折算（本来就是可叠加的）', async () => {
      pools = [{ ...POOL, pity: 0, entries: [item('s', 1, 'cons_snack')] }];
      items.ownedMap.mockResolvedValue(new Map([['def-cons_snack', 5]]));

      const res = await svc.draw('u1', 'daily', 1, 'b1');

      expect(res.prizes[0].converted).toBe(false);
      expect(items.grantUnlocked).toHaveBeenCalledWith('u1', 'cons_snack', 1);
    });

    it('配置指向不存在的物品时折成币，而不是让玩家白花钱', async () => {
      items.getDefByKey.mockResolvedValue(null);

      const res = await svc.draw('u1', 'daily', 1, 'b1');

      expect(res.prizes[0].converted).toBe(true);
      expect(res.prizes[0].amount).toBe(120);
      expect(items.grantUnlocked).not.toHaveBeenCalled();
    });
  });

  describe('发放', () => {
    it('整轮的币合成一笔入账，且 bizId 由抽奖 bizId 派生（可幂等重放）', async () => {
      pools = [{ ...POOL, pity: 0, entries: [coin('c60', 1, 60)] }];

      await svc.draw('u1', 'daily', 10, 'b1');

      const credits = argsOf<{
        delta: number;
        bizId: string;
        reason: string;
      }>(economy.apply).filter((c) => c.delta > 0);
      expect(credits).toHaveLength(1);
      expect(credits[0].delta).toBe(600);
      expect(credits[0].bizId).toBe('gacha-payout:b1');
      expect(credits[0].reason).toBe('gacha');
    });

    it('全是物品档时不产生入账流水', async () => {
      pools = [{ ...POOL, pity: 0, entries: [item('f', 1, 'furn_rug')] }];
      items.getDefByKey.mockResolvedValue(defOf('furn_rug', 'furniture'));

      await svc.draw('u1', 'daily', 1, 'b1');

      const credits = argsOf<{ delta: number }>(economy.apply).filter(
        (c) => c.delta > 0,
      );
      expect(credits).toHaveLength(0);
    });

    it('扣费 bizId 带 gacha: 前缀，与入账流水互不撞键', async () => {
      await svc.draw('u1', 'daily', 1, 'b1');
      const debit = argOf<{ bizId: string }>(economy.apply);
      expect(debit.bizId).toBe('gacha:b1');
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
        { key: 'c60', name: 'c60', rare: false, percent: 90 },
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
