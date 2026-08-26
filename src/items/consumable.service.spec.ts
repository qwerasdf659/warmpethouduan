import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LockService } from '../common/lock/lock.service';
import { GameConfigService } from '../config/game-config.service';
import { EconomyService } from '../economy/economy.service';
import { ItemDef } from '../entities/item-def.entity';
import { PetService, PetStateView } from '../pet/pet.service';
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

function defOf(key: string, type: ItemDef['type'], price = 60): ItemDef {
  return {
    id: `def-${key}`,
    key,
    type,
    name: key,
    price,
    pool: 'game',
    sortOrder: 1,
  } as ItemDef;
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
      ownedMap: jest.fn(() =>
        Promise.resolve(new Map([['def-cons_snack', 3]])),
      ),
      buy: jest.fn(() =>
        Promise.resolve({
          itemKey: 'cons_snack',
          qty: 4,
          wallet: { gameCoin: 900, marketingPoint: 0 },
          duplicated: false,
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
        Promise.resolve({ gameCoin: 1000, marketingPoint: 0 }),
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
      const res = await svc.use('u1', 'cons_snack');

      expect(items.consumeOwned).toHaveBeenCalledWith(
        'u1',
        'def-cons_snack',
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

    it('持有量不足时报错，且不施加任何效果', async () => {
      items.consumeOwned.mockResolvedValue(null);

      await expect(svc.use('u1', 'cons_snack')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(pet.applyConsumable).not.toHaveBeenCalled();
    });

    it('效果没配置时**先拒绝再扣道具**，不能扣掉道具什么都不发生', async () => {
      await expect(svc.use('u1', 'cons_broken')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(items.consumeOwned).not.toHaveBeenCalled();
      expect(pet.applyConsumable).not.toHaveBeenCalled();
    });

    it('配置里完全没有这一项时同样拒绝', async () => {
      items.getDefByKey.mockResolvedValue(defOf('cons_ghost', 'consumable'));
      await expect(svc.use('u1', 'cons_ghost')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(items.consumeOwned).not.toHaveBeenCalled();
    });

    it('非消耗品不能使用', async () => {
      items.getDefByKey.mockResolvedValue(defOf('furn_rug', 'furniture'));
      await expect(svc.use('u1', 'furn_rug')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('多宠时把 petId 透传下去', async () => {
      await svc.use('u1', 'cons_cake', 'pet-9');
      expect(pet.applyConsumable).toHaveBeenCalledWith(
        'u1',
        { hunger: 20, mood: 25, exp: 30 },
        'pet-9',
      );
    });

    it('全程只抢一次 pet 锁（Redis 锁不可重入，抢两次就是自死锁）', async () => {
      await svc.use('u1', 'cons_snack');
      expect(lockCalls).toEqual(['pet:u1']);
    });
  });
});
