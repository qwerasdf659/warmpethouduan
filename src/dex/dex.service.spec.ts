import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { LockService } from '../common/lock/lock.service';
import { GameConfigService } from '../config/game-config.service';
import { EconomyService } from '../economy/economy.service';
import { DexClaim } from '../entities/dex-claim.entity';
import { ItemsService } from '../items/items.service';
import type { PetStateView } from '../pet/pet-math';
import { PetService } from '../pet/pet.service';
import { DexEntry } from './dex.config';
import { DexService } from './dex.service';

interface ClaimsStub {
  find: jest.Mock;
  findOne: jest.Mock;
  save: jest.Mock;
  create: jest.Mock;
}
interface PetStub {
  peekPets: jest.Mock;
}
interface ItemsStub {
  ownedKindCount: jest.Mock;
}
interface EconomyStub {
  apply: jest.Mock;
}

const ENTRIES: DexEntry[] = [
  {
    key: 'lv5',
    name: '初长成',
    desc: '',
    type: 'maxLevel',
    target: 5,
    reward: 50,
    sortOrder: 1,
  },
  {
    key: 'skin3',
    name: '衣橱初成',
    desc: '',
    type: 'ownedSkin',
    target: 3,
    reward: 120,
    sortOrder: 30,
  },
  {
    key: 'furn4',
    name: '安乐窝',
    desc: '',
    type: 'ownedFurniture',
    target: 4,
    reward: 200,
    sortOrder: 32,
  },
  {
    key: 'collect10',
    name: '博物学家',
    desc: '',
    type: 'ownedAll',
    target: 10,
    reward: 400,
    sortOrder: 40,
  },
];

function petOf(level: number): PetStateView {
  return { level, intimacy: 0 } as PetStateView;
}

/**
 * 图鉴的收集类进度：按「拥有多少种」推进，且必须真的读玩家持有量——
 * 此前买再多皮肤都不点亮任何图鉴格，与规格不符。
 */
describe('DexService 收集类图鉴', () => {
  let claims: ClaimsStub;
  let pet: PetStub;
  let items: ItemsStub;
  let economy: EconomyStub;
  let svc: DexService;

  beforeEach(() => {
    claims = {
      find: jest.fn(() => Promise.resolve([])),
      findOne: jest.fn(() => Promise.resolve(null)),
      save: jest.fn((v: unknown) => Promise.resolve(v)),
      create: jest.fn((v: unknown) => v),
    };
    pet = { peekPets: jest.fn(() => Promise.resolve([petOf(3)])) };
    items = {
      ownedKindCount: jest.fn(() =>
        Promise.resolve({ skin: 3, accessory: 1, furniture: 2 }),
      ),
    };
    economy = {
      apply: jest.fn(() =>
        Promise.resolve({
          wallet: { gameCoin: 999, marketingPoint: 0 },
          duplicated: false,
        }),
      ),
    };

    const config = {
      get: () => Promise.resolve(ENTRIES),
    } as unknown as GameConfigService;
    const lock = {
      withLock: <T>(_k: string, fn: () => Promise<T>) => fn(),
    } as unknown as LockService;

    svc = new DexService(
      claims as unknown as Repository<DexClaim>,
      pet as unknown as PetService,
      economy as unknown as EconomyService,
      lock,
      config,
      items as unknown as ItemsService,
    );
  });

  it('按物品类型统计种类数推进对应条目', async () => {
    const { entries } = await svc.getDex('u1');

    const skin = entries.find((e) => e.key === 'skin3');
    expect(skin?.progress).toBe(3);
    expect(skin?.unlocked).toBe(true);

    const furn = entries.find((e) => e.key === 'furn4');
    expect(furn?.progress).toBe(2);
    expect(furn?.unlocked).toBe(false);
  });

  it('ownedAll 跨类型合计', async () => {
    const { entries } = await svc.getDex('u1');
    const all = entries.find((e) => e.key === 'collect10');
    // 3 + 1 + 2 = 6，未达 10
    expect(all?.progress).toBe(6);
    expect(all?.unlocked).toBe(false);
  });

  it('养成类条目仍走宠物状态，不受收集数影响', async () => {
    const { entries } = await svc.getDex('u1');
    const lv = entries.find((e) => e.key === 'lv5');
    expect(lv?.progress).toBe(3);
    expect(lv?.unlocked).toBe(false);
  });

  it('收集类达标可领奖，bizId 由服务端派生', async () => {
    await svc.claim('u1', 'skin3');
    expect(economy.apply).toHaveBeenCalledWith(
      expect.objectContaining({ delta: 120, bizId: 'dex:skin3' }),
    );
  });

  it('收集类未达标拒绝领奖', async () => {
    await expect(svc.claim('u1', 'furn4')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(economy.apply).not.toHaveBeenCalled();
  });

  it('没有收集类条目时不查物品表（省掉一次 join）', async () => {
    const onlyPetEntries = [ENTRIES[0]];
    const config = {
      get: () => Promise.resolve(onlyPetEntries),
    } as unknown as GameConfigService;
    const lean = new DexService(
      claims as unknown as Repository<DexClaim>,
      pet as unknown as PetService,
      economy as unknown as EconomyService,
      {
        withLock: <T>(_k: string, fn: () => Promise<T>) => fn(),
      } as unknown as LockService,
      config,
      items as unknown as ItemsService,
    );

    await lean.getDex('u1');
    expect(items.ownedKindCount).not.toHaveBeenCalled();
  });

  it('未拥有任何物品时收集进度为 0，而不是崩掉', async () => {
    items.ownedKindCount.mockResolvedValue({});
    const { entries } = await svc.getDex('u1');
    expect(entries.find((e) => e.key === 'skin3')?.progress).toBe(0);
    expect(entries.find((e) => e.key === 'collect10')?.progress).toBe(0);
  });
});
