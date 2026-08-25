import { Repository } from 'typeorm';
import { LockService } from '../common/lock/lock.service';
import { GameConfig } from '../entities/game-config.entity';
import { CONFIG_REGISTRY } from './game-config.registry';
import { GameConfigService } from './game-config.service';

/**
 * 配置加载层的三条硬约束：DB 优先、脏数据单项回退、永不因配置问题抛错。
 * 这些是运营调参通道的安全网——错一条就可能让一次误填打崩整个玩法。
 */
describe('GameConfigService', () => {
  const DEFAULT_RATES = CONFIG_REGISTRY['pet.rates'].default;
  const DEFAULT_CAP = CONFIG_REGISTRY['pet.max_pets_per_user'].default;

  interface RepoStub {
    find: jest.Mock;
  }

  function makeService(rows: Partial<GameConfig>[]): {
    svc: GameConfigService;
    repo: RepoStub;
  } {
    const repo: RepoStub = { find: jest.fn(() => Promise.resolve(rows)) };
    const svc = new GameConfigService(
      repo as unknown as Repository<GameConfig>,
      null as unknown as LockService,
    );
    return { svc, repo };
  }

  describe('取值来源', () => {
    it('库里有合法值时以库为准', async () => {
      const { svc } = makeService([{ key: 'pet.max_pets_per_user', value: 3 }]);
      expect(await svc.get('pet.max_pets_per_user')).toBe(3);
    });

    it('库里缺这一项时回退代码默认值', async () => {
      const { svc } = makeService([]);
      expect(await svc.get('pet.max_pets_per_user')).toBe(DEFAULT_CAP);
    });

    it('Joi 归一化：字符串数字转成数字', async () => {
      const { svc } = makeService([
        { key: 'pet.max_pets_per_user', value: '4' },
      ]);
      expect(await svc.get('pet.max_pets_per_user')).toBe(4);
    });
  });

  describe('脏数据兜底', () => {
    it('单项非法只回退该项，不影响同批其它项', async () => {
      const { svc } = makeService([
        { key: 'pet.rates', value: { hunger: '坏数据' } },
        { key: 'pet.max_pets_per_user', value: 5 },
      ]);
      expect(await svc.get('pet.rates')).toEqual(DEFAULT_RATES);
      expect(await svc.get('pet.max_pets_per_user')).toBe(5);
    });

    it('值越界（速率为负）时回退默认值', async () => {
      const { svc } = makeService([
        { key: 'pet.rates', value: { ...DEFAULT_RATES, hunger: -10 } },
      ]);
      expect(await svc.get('pet.rates')).toEqual(DEFAULT_RATES);
    });

    it('DB 读取失败时不抛错，全部走默认值', async () => {
      const repo = {
        find: jest.fn(() => Promise.reject(new Error('connection refused'))),
      };
      const svc = new GameConfigService(
        repo as unknown as Repository<GameConfig>,
        null as unknown as LockService,
      );
      expect(await svc.get('pet.rates')).toEqual(DEFAULT_RATES);
    });

    it('DB 读取失败但已有快照时沿用旧快照，而非退回默认值', async () => {
      const repo = {
        find: jest.fn(() =>
          Promise.resolve([{ key: 'pet.max_pets_per_user', value: 9 }]),
        ),
      };
      const svc = new GameConfigService(
        repo as unknown as Repository<GameConfig>,
        null as unknown as LockService,
      );
      expect(await svc.get('pet.max_pets_per_user')).toBe(9);

      repo.find.mockRejectedValueOnce(new Error('connection refused'));
      svc.invalidate();
      expect(await svc.get('pet.max_pets_per_user')).toBe(9);
    });
  });

  describe('缓存', () => {
    it('TTL 内重复取值只打一次 DB', async () => {
      const { svc, repo } = makeService([]);
      await svc.snapshot();
      await svc.snapshot();
      await svc.get('pet.rates');
      expect(repo.find).toHaveBeenCalledTimes(1);
    });

    it('并发首次取值也只打一次 DB（防惊群）', async () => {
      const { svc, repo } = makeService([]);
      await Promise.all([svc.snapshot(), svc.snapshot(), svc.snapshot()]);
      expect(repo.find).toHaveBeenCalledTimes(1);
    });

    it('invalidate 后立刻重新读库', async () => {
      const { svc, repo } = makeService([
        { key: 'pet.max_pets_per_user', value: 3 },
      ]);
      expect(await svc.get('pet.max_pets_per_user')).toBe(3);

      repo.find.mockResolvedValue([{ key: 'pet.max_pets_per_user', value: 8 }]);
      // 不失效则仍读到旧值
      expect(await svc.get('pet.max_pets_per_user')).toBe(3);

      svc.invalidate();
      expect(await svc.get('pet.max_pets_per_user')).toBe(8);
      expect(repo.find).toHaveBeenCalledTimes(2);
    });
  });

  describe('validate 写入校验', () => {
    it('合法值通过并返回归一化结果', () => {
      const { svc } = makeService([]);
      expect(svc.validate('pet.max_pets_per_user', '6')).toBe(6);
    });

    it('未注册的 key 抛错', () => {
      const { svc } = makeService([]);
      expect(() => svc.validate('pet.不存在', 1)).toThrow('未注册的配置项');
    });

    it('多余字段被拒绝（防运营拼错字段名后静默失效）', () => {
      const { svc } = makeService([]);
      expect(() =>
        svc.validate('pet.rates', { ...DEFAULT_RATES, hungerr: 5 }),
      ).toThrow();
    });

    it('缺字段被拒绝', () => {
      const { svc } = makeService([]);
      expect(() => svc.validate('pet.rates', { hunger: 5 })).toThrow();
    });

    it('跨字段约束：签到封顶不得低于基础值', () => {
      const { svc } = makeService([]);
      expect(() =>
        svc.validate('daily.checkin', {
          baseCoin: 50,
          streakStepCoin: 10,
          maxCoin: 20,
        }),
      ).toThrow();
    });

    it('结构性枚举收口：任务进度来源只能是已实现的三种', () => {
      const { svc } = makeService([]);
      expect(() =>
        svc.validate('daily.tasks', [
          { key: 'k', name: 'n', target: 1, coin: 1, source: 'unknown' },
        ]),
      ).toThrow();
    });
  });

  it('每个注册项的默认值本身必须合法（兜底不能是坏的）', () => {
    const { svc } = makeService([]);
    for (const key of Object.keys(CONFIG_REGISTRY)) {
      expect(() => svc.validate(key, svc.defaultOf(key))).not.toThrow();
    }
  });
});
