import { BadRequestException } from '@nestjs/common';
import type * as Joi from 'joi';
import { Repository } from 'typeorm';
import { CONFIG_REGISTRY } from '../../config/game-config.registry';
import { GameConfigService } from '../../config/game-config.service';
import { GameConfig } from '../../entities/game-config.entity';
import { AdminConfigService } from './admin-config.service';

/**
 * 后台写配置的两个要点：非法值必须挡在 DB 之外；写成功必须让加载层缓存失效，
 * 否则运营点了保存却要等重启才生效，配置中心等于没做。
 */
describe('AdminConfigService', () => {
  const DEFAULT_RATES = CONFIG_REGISTRY['pet.rates'].default;

  interface RepoStub {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  }

  let repo: RepoStub;
  let invalidate: jest.Mock;
  let gameConfig: GameConfigService;
  let svc: AdminConfigService;

  beforeEach(() => {
    repo = {
      find: jest.fn(() => Promise.resolve([])),
      findOne: jest.fn(() => Promise.resolve(null)),
      create: jest.fn((v: Partial<GameConfig>) => ({ ...v })),
      save: jest.fn((v: GameConfig) =>
        Promise.resolve({ ...v, updatedAt: new Date() }),
      ),
      delete: jest.fn(() => Promise.resolve({ affected: 1 })),
    };
    invalidate = jest.fn();
    // 复用真实注册表的 schema，保证「后台校验」与「加载层校验」判定一致
    const validate = jest.fn((key: string, value: unknown): unknown => {
      const entry = CONFIG_REGISTRY[key as keyof typeof CONFIG_REGISTRY];
      const res: Joi.ValidationResult<unknown> = entry.schema.validate(value, {
        convert: true,
      });
      if (res.error) throw new Error(res.error.message);
      return res.value;
    });
    gameConfig = { validate, invalidate } as unknown as GameConfigService;
    svc = new AdminConfigService(
      repo as unknown as Repository<GameConfig>,
      gameConfig,
    );
  });

  describe('upsert 写入', () => {
    it('合法值落库并让缓存失效', async () => {
      const res = await svc.upsert('pet.max_pets_per_user', { value: 4 });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'pet.max_pets_per_user', value: 4 }),
      );
      expect(invalidate).toHaveBeenCalled();
      expect(res.config.value).toBe(4);
    });

    it('存的是归一化后的值（"4" → 4）', async () => {
      await svc.upsert('pet.max_pets_per_user', { value: '4' });
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ value: 4 }),
      );
    });

    it('非法值 → 400，且不落库、不动缓存', async () => {
      await expect(
        svc.upsert('pet.rates', { value: { hunger: -1 } }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
      expect(invalidate).not.toHaveBeenCalled();
    });

    it('未注册的 key → 400（防写出永不生效的幽灵配置）', async () => {
      await expect(
        svc.upsert('pet.typo_key', { value: 1 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('新建行时用注册表里的说明作为默认描述', async () => {
      await svc.upsert('pet.rates', { value: DEFAULT_RATES });
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          description: CONFIG_REGISTRY['pet.rates'].description,
        }),
      );
    });
  });

  describe('reset 恢复默认', () => {
    it('写回默认值并让缓存失效', async () => {
      repo.findOne.mockResolvedValue({
        key: 'pet.rates',
        value: { ...DEFAULT_RATES, hunger: 99 },
        description: '',
      });

      const res = await svc.reset('pet.rates');

      expect(res.config.value).toEqual(DEFAULT_RATES);
      expect(res.config.modified).toBe(false);
      expect(invalidate).toHaveBeenCalled();
    });

    it('未注册的 key → 400', async () => {
      await expect(svc.reset('pet.typo_key')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('remove 删除保护', () => {
    it('注册项禁止删除（删掉运营就再也调不到了）', async () => {
      await expect(svc.remove('pet.rates')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('未注册的历史遗留 key 允许清理', async () => {
      await expect(svc.remove('legacy.junk')).resolves.toEqual({ ok: true });
      expect(repo.delete).toHaveBeenCalledWith({ key: 'legacy.junk' });
      expect(invalidate).toHaveBeenCalled();
    });
  });

  describe('list 元信息', () => {
    it('标出未注册项与「已偏离默认值」', async () => {
      repo.find.mockResolvedValue([
        {
          key: 'pet.rates',
          value: { ...DEFAULT_RATES, hunger: 9 },
          description: '',
          updatedAt: new Date(),
        },
        {
          key: 'legacy.junk',
          value: {},
          description: '',
          updatedAt: new Date(),
        },
      ]);

      const { list } = await svc.list();

      expect(list[0]).toMatchObject({ registered: true, modified: true });
      expect(list[1]).toMatchObject({ registered: false, default: null });
    });

    it('键序不同但内容相同 → 不算「已改」', async () => {
      // jsonb 存取会重排对象键，用 JSON.stringify 比较会把没动过的项全标成已改
      const reordered = Object.fromEntries(
        Object.entries(DEFAULT_RATES).reverse(),
      );
      repo.find.mockResolvedValue([
        {
          key: 'pet.rates',
          value: reordered,
          description: '',
          updatedAt: new Date(),
        },
      ]);

      const { list } = await svc.list();
      expect(list[0].modified).toBe(false);
    });

    it('嵌套结构里改了一个数就算「已改」', async () => {
      const tracks = CONFIG_REGISTRY['race.tracks'].default;
      const tweaked = tracks.map((t, i) =>
        i === 0 ? { ...t, entryCoin: t.entryCoin + 1 } : t,
      );
      repo.find.mockResolvedValue([
        {
          key: 'race.tracks',
          value: tweaked,
          description: '',
          updatedAt: new Date(),
        },
      ]);

      const { list } = await svc.list();
      expect(list[0].modified).toBe(true);
    });

    it('数组顺序变了也算「已改」（档位顺序有语义）', async () => {
      const tracks = CONFIG_REGISTRY['race.tracks'].default;
      repo.find.mockResolvedValue([
        {
          key: 'race.tracks',
          value: [...tracks].reverse(),
          description: '',
          updatedAt: new Date(),
        },
      ]);

      const { list } = await svc.list();
      expect(list[0].modified).toBe(true);
    });
  });
});
