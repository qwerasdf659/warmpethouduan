import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LockService } from '../common/lock/lock.service';
import { GameConfigService } from '../config/game-config.service';
import { EconomyService } from '../economy/economy.service';
import type { AssetView, ItemType } from '../ledger/asset-catalog.service';
import type { PetStateView } from '../pet/pet-math';
import { PetService } from '../pet/pet.service';
import { ConsumableService } from './consumable.service';
import { ConsumableTable } from './items.config';
import { ItemsService } from './items.service';

interface ItemsStub {
  listDefsByType: jest.Mock;
  getDefByKey: jest.Mock;
  ownedMap: jest.Mock;
  buy: jest.Mock;
  consumeOwned: jest.Mock;
}

function defOf(code: string, itemType: ItemType, price = 60): AssetView {
  return {
    code,
    kind:
      itemType === 'skin' || itemType === 'accessory' ? 'unique' : 'stackable',
    itemType,
    name: code,
    slot: null,
    price,
    priceAsset: 'game_coin',
    comfort: 0,
    gridW: 1,
    gridH: 1,
    tradable: true,
    redeemable: false,
    mintLimit: null,
    mintedCount: 0,
    enabled: true,
    sortOrder: 1,
    meta: {},
  };
}

const TABLE: ConsumableTable = {
  cons_snack: { hunger: 25 },
  cons_cake: { hunger: 20, mood: 25, exp: 30 },
  // 目录里有、效果没配（或被配成空）的脏数据
  cons_broken: {},
};

describe('ConsumableService', () => {
  let items: ItemsStub;
  let pet: { applyConsumable: jest.Mock };
  let economy: { getWallet: jest.Mock };
  let lockCalls: string[];
  let svc: ConsumableService;

  beforeEach(() => {
    items = {
      listDefsByType: jest.fn(() =>
        Promise.resolve([
          defOf('cons_snack', 'consumable'),
          defOf('cons_cake', 'consumable', 300),
        ]),
      ),
      getDefByKey: jest.fn((key: string) =>
        Promise.resolve(defOf(key, 'consumable')),
      ),
      // 新模型下持有量按 assetCode 索引，不再是 item_def 的自增 id
      ownedMap: jest.fn(() => Promise.resolve(new Map([['cons_snack', 3]]))),
      buy: jest.fn(() =>
        Promise.resolve({
          itemKey: 'cons_snack',
          qty: 4,
          wallet: {
            gameCoin: 900,
            marketingPoint: 0,
            gameCoinFrozen: 0,
            marketingPointFrozen: 0,
          },
          duplicated: false,
          serial: null,
        }),
      ),
      consumeOwned: jest.fn(() => Promise.resolve(2)),
    };
    pet = {
      applyConsumable: jest.fn(() =>
        Promise.resolve({
          pet: { level: 3, hunger: 90 } as PetStateView,
          levelUp: false,
        }),
      ),
    };
    economy = {
      getWallet: jest.fn(() =>
        Promise.resolve({
          gameCoin: 1000,
          marketingPoint: 0,
          gameCoinFrozen: 0,
          marketingPointFrozen: 0,
        }),
      ),
    };

    lockCalls = [];
    const lock = {
      withLock: <T>(key: string, fn: () => Promise<T>) => {
        lockCalls.push(key);
        return fn();
      },
    } as unknown as LockService;
    const config = {
      get: () => Promise.resolve(TABLE),
    } as unknown as GameConfigService;

    svc = new ConsumableService(
      items as unknown as ItemsService,
      pet as unknown as PetService,
      economy as unknown as EconomyService,
      config,
      lock,
    );
  });

  describe('list', () => {
    it('目录带上效果、我的持有量与余额', async () => {
      const res = await svc.list('u1');

      expect(res.items).toHaveLength(2);
      expect(res.items[0]).toMatchObject({
        key: 'cons_snack',
        price: 60,
        effect: { hunger: 25 },
        owned: 3,
      });
      // 没买过的显示 0，而不是 undefined
      expect(res.items[1].owned).toBe(0);
      expect(res.wallet.gameCoin).toBe(1000);
    });

    it('只查 consumable 类型，不把皮肤家具混进消耗品商店', async () => {
      await svc.list('u1');
      expect(items.listDefsByType).toHaveBeenCalledWith(['consumable']);
    });
  });

  describe('buy', () => {
    it('把份数透传给 ItemsService.buy', async () => {
      await svc.buy('u1', 'cons_snack', 5, 'b1');
      expect(items.buy).toHaveBeenCalledWith('u1', 'cons_snack', 'b1', 5);
    });

    it('物品不存在时拒绝', async () => {
      items.getDefByKey.mockResolvedValue(null);
      await expect(svc.buy('u1', 'nope', 1, 'b1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(items.buy).not.toHaveBeenCalled();
    });

    it('拒绝拿非消耗品走消耗品入口（否则能绕开换装的槽位校验）', async () => {
      items.getDefByKey.mockResolvedValue(defOf('skin_snow', 'skin', 400));
      await expect(svc.buy('u1', 'skin_snow', 1, 'b1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(items.buy).not.toHaveBeenCalled();
    });
  });

  describe('use', () => {
    it('先扣道具再施加效果，并返回剩余份数', async () => {
      const res = await svc.use('u1', 'cons_snack', 'b1');

      expect(items.consumeOwned).toHaveBeenCalledWith(
        'u1',
        'cons_snack',
        'b1',
        1,
      );
      expect(pet.applyConsumable).toHaveBeenCalledWith(
        'u1',
        { hunger: 25 },
        undefined,
      );
      expect(res).toMatchObject({
        itemKey: 'cons_snack',
        left: 2,
        effect: { hunger: 25 },
        levelUp: false,
      });
    });

    /**
     * 扣减改由账本的条件 UPDATE 拦住并抛异常（整个事务回滚），
     * 不再返回 null 让调用方自己判 —— 那个 null 曾因 `rowsOf` 用错而变成 NaN，
     * 调用方判 `=== null` 放行，等于不限量消耗。
     */
    it('持有量不足时异常向上抛，且不施加任何效果', async () => {
      items.consumeOwned.mockRejectedValue(new BadRequestException('余额不足'));

      await expect(svc.use('u1', 'cons_snack', 'b1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(pet.applyConsumable).not.toHaveBeenCalled();
    });

    it('效果没配置时**先拒绝再扣道具**，不能扣掉道具什么都不发生', async () => {
      await expect(svc.use('u1', 'cons_broken', 'b1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(items.consumeOwned).not.toHaveBeenCalled();
      expect(pet.applyConsumable).not.toHaveBeenCalled();
    });

    it('配置里完全没有这一项时同样拒绝', async () => {
      items.getDefByKey.mockResolvedValue(defOf('cons_ghost', 'consumable'));
      await expect(svc.use('u1', 'cons_ghost', 'b1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(items.consumeOwned).not.toHaveBeenCalled();
    });

    it('非消耗品不能使用', async () => {
      items.getDefByKey.mockResolvedValue(defOf('furn_rug', 'furniture'));
      await expect(svc.use('u1', 'furn_rug', 'b1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('多宠时把 petId 透传下去', async () => {
      await svc.use('u1', 'cons_cake', 'b1', 'pet-9');
      expect(pet.applyConsumable).toHaveBeenCalledWith(
        'u1',
        { hunger: 20, mood: 25, exp: 30 },
        'pet-9',
      );
    });

    it('全程只抢一次 pet 锁（Redis 锁不可重入，抢两次就是自死锁）', async () => {
      await svc.use('u1', 'cons_snack', 'b1');
      expect(lockCalls).toEqual(['pet:u1']);
    });

    /**
     * `bizId` 必须一路传到扣减：它是持久幂等的载体。旧实现里
     * `UseConsumableDto.bizId` 存在但控制器没往下传，于是扣减只被
     * Redis 24h 窗口覆盖，隔日重试会真的再扣一份。
     */
    it('bizId 透传到扣减，保证重复提交是回放而不是再扣一份', async () => {
      await svc.use('u1', 'cons_snack', 'client-uuid-1');
      expect(items.consumeOwned).toHaveBeenCalledWith(
        'u1',
        'cons_snack',
        'client-uuid-1',
        1,
      );
    });
  });
});
