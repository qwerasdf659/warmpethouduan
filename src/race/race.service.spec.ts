import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import { AdTokenService } from '../boost/ad-token.service';
import { ClockService } from '../common/clock/clock.service';
import { GameConfigService } from '../config/game-config.service';
import { EconomyService } from '../economy/economy.service';
import { RaceRecord } from '../entities/race-record.entity';
import { PetService } from '../pet/pet.service';
import { RACE_CONFIG } from './race.config';
import { RaceService } from './race.service';

/** 断言基准取代码内置默认值，与线上未改配置时的行为一致。 */
const RACE_REVIVE = RACE_CONFIG['race.revive'].default;

const configStub = {
  snapshot: () =>
    Promise.resolve({
      'race.tracks': RACE_CONFIG['race.tracks'].default,
      'race.opponent_count': RACE_CONFIG['race.opponent_count'].default,
      'race.revive': RACE_REVIVE,
      'race.rank_factor': RACE_CONFIG['race.rank_factor'].default,
      'race.formula': RACE_CONFIG['race.formula'].default,
      'race.grade_thresholds': RACE_CONFIG['race.grade_thresholds'].default,
      'race.ghost': RACE_CONFIG['race.ghost'].default,
    }),
} as unknown as GameConfigService;

/**
 * 桩依赖只声明本测试用到的方法。相比 `any`，这样改被测服务签名时编译器会报错，
 * 不至于让测试静默地测了个空壳。
 */
interface RacesStub {
  findOne: jest.Mock;
  update: jest.Mock;
  save: jest.Mock;
  create: jest.Mock;
  createQueryBuilder: jest.Mock;
}
interface PetStub {
  getBattleStats: jest.Mock;
  raceSpendStamina: jest.Mock;
}
interface EconomyStub {
  apply: jest.Mock;
  getWallet: jest.Mock;
}
interface AdTokenStub {
  consume: jest.Mock;
}
interface RedisStub {
  incr: jest.Mock;
  expire: jest.Mock;
}

/**
 * 赛跑「看广告增值」两个端点的状态机与幂等约束。
 * 翻倍必须发生在已结算之后且每场一次；复活只对未结算的比赛生效且限次。
 */
describe('RaceService 看广告增值', () => {
  let races: RacesStub;
  let pet: PetStub;
  let economy: EconomyStub;
  let adToken: AdTokenStub;
  let redis: RedisStub;
  let svc: RaceService;

  /** 一场已结算、名次 2、奖励 100 的比赛。 */
  function settledRace(over: Partial<RaceRecord> = {}): RaceRecord {
    return {
      id: 'r1',
      userId: 'u1',
      bizId: 'biz-r1',
      petId: 'p1',
      trackKey: 'meadow',
      petLevel: 3,
      score: 100,
      finishTime: 21.5,
      grade: 'A',
      ghostSource: 'npc',
      rank: 2,
      totalRacers: 4,
      rewardCoin: 100,
      staminaCost: 20,
      status: 'settled',
      rewardDoubled: false,
      reviveCount: 0,
      settledAt: new Date(),
      createdAt: new Date(),
      ...over,
    };
  }

  /** 影子采样返回空：让 revive 走 NPC 兜底，名次可预期地只受公式影响。 */
  interface SampleQb {
    select: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    limit: jest.Mock;
    getRawMany: jest.Mock;
  }
  function emptySampleQb(): SampleQb {
    const qb: SampleQb = {
      select: jest.fn(() => qb),
      where: jest.fn(() => qb),
      andWhere: jest.fn(() => qb),
      orderBy: jest.fn(() => qb),
      limit: jest.fn(() => qb),
      getRawMany: jest.fn(() => Promise.resolve([])),
    };
    return qb;
  }

  beforeEach(() => {
    races = {
      findOne: jest.fn(),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
      save: jest.fn(),
      create: jest.fn(),
      createQueryBuilder: jest.fn(() => emptySampleQb()),
    };
    const battle = {
      petId: 'p1',
      nickname: null,
      level: 3,
      speed: 12,
      endurance: 11.6,
      stamina: 60,
      staminaMax: 104,
      mood: 80,
    };
    pet = {
      getBattleStats: jest.fn(() => Promise.resolve(battle)),
      raceSpendStamina: jest.fn(() => Promise.resolve(battle)),
    };
    economy = {
      apply: jest.fn(() =>
        Promise.resolve({
          wallet: { gameCoin: 300, marketingPoint: 0 },
          entry: {},
          duplicated: false,
        }),
      ),
      getWallet: jest.fn(() =>
        Promise.resolve({ gameCoin: 200, marketingPoint: 0 }),
      ),
    };
    adToken = { consume: jest.fn(() => Promise.resolve(undefined)) };
    redis = {
      incr: jest.fn(() => Promise.resolve(1)),
      expire: jest.fn(() => Promise.resolve(1)),
    };

    svc = new RaceService(
      races as unknown as Repository<RaceRecord>,
      pet as unknown as PetService,
      economy as unknown as EconomyService,
      // revive 会经影子采样读时钟算回溯起点，给个固定时钟
      {
        now: () => new Date('2026-08-26T00:00:00Z'),
      } as unknown as ClockService,
      adToken as unknown as AdTokenService,
      configStub,
      { bonusOfPetId: () => Promise.resolve({ raceScore: 0 }) } as never, // petBonus
      { bump: () => Promise.resolve() } as never, // eventProgress
      redis as unknown as Redis,
    );
  });

  describe('start 报名幂等', () => {
    it('同一 bizId 已开过一场：拒绝，且不扣体力、不扣门票、不落库', async () => {
      races.findOne.mockResolvedValue({ id: 'r9' });

      await expect(svc.start('u1', 'meadow', 'biz-dup')).rejects.toThrow(
        ConflictException,
      );

      // 拦截必须发生在花掉资源之前，否则「拒绝了但体力已扣」比重复开赛还糟
      expect(pet.raceSpendStamina).not.toHaveBeenCalled();
      expect(economy.apply).not.toHaveBeenCalled();
      expect(races.save).not.toHaveBeenCalled();
    });

    it('新 bizId：落库时带上该键，让去重落到唯一索引而不只是 Redis', async () => {
      races.findOne.mockResolvedValue(null);
      races.create.mockImplementation((v: unknown) => v);
      races.save.mockImplementation((v: { id?: string }) =>
        Promise.resolve({ ...v, id: 'r1' }),
      );

      await svc.start('u1', 'meadow', 'biz-new');

      expect(races.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', bizId: 'biz-new' }),
      );
    });
  });

  describe('doubleReward 奖励翻倍', () => {
    it('已结算且未翻倍：核销凭证并再发一份等额奖励', async () => {
      races.findOne.mockResolvedValue(settledRace());

      const res = await svc.doubleReward('u1', 'r1', 'nonce1');

      expect(adToken.consume).toHaveBeenCalledWith(
        'u1',
        'nonce1',
        'race_double',
      );
      expect(economy.apply).toHaveBeenCalledWith(
        expect.objectContaining({
          delta: 100,
          // 稳定 bizId：换客户端 bizId 也无法重复领
          bizId: 'race:double:r1',
          reason: 'race',
        }),
      );
      expect(res).toMatchObject({
        bonusCoin: 100,
        totalRewardCoin: 200,
        gameCoin: 300,
        duplicated: false,
      });
    });

    it('翻倍落库带 rewardDoubled:false 条件，兜住并发', async () => {
      races.findOne.mockResolvedValue(settledRace());
      await svc.doubleReward('u1', 'r1', 'nonce1');

      expect(races.update).toHaveBeenCalledWith(
        { id: 'r1', rewardDoubled: false },
        { rewardDoubled: true },
      );
    });

    it('已翻倍：回放，不消耗凭证也不再发币', async () => {
      races.findOne.mockResolvedValue(settledRace({ rewardDoubled: true }));

      const res = await svc.doubleReward('u1', 'r1', 'nonce1');

      expect(res.duplicated).toBe(true);
      expect(adToken.consume).not.toHaveBeenCalled();
      expect(economy.apply).not.toHaveBeenCalled();
    });

    it('未结算：拒绝翻倍', async () => {
      races.findOne.mockResolvedValue(
        settledRace({ status: 'pending', settledAt: null }),
      );

      await expect(svc.doubleReward('u1', 'r1', 'n')).rejects.toThrow(
        '请先结算本场比赛再翻倍',
      );
      expect(adToken.consume).not.toHaveBeenCalled();
    });

    it('本场无奖励：拒绝翻倍', async () => {
      races.findOne.mockResolvedValue(settledRace({ rewardCoin: 0 }));

      await expect(svc.doubleReward('u1', 'r1', 'n')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('凭证无效：不发币', async () => {
      races.findOne.mockResolvedValue(settledRace());
      adToken.consume.mockRejectedValue(
        new BadRequestException('广告凭证无效或已过期'),
      );

      await expect(svc.doubleReward('u1', 'r1', 'bad')).rejects.toThrow(
        '广告凭证无效或已过期',
      );
      expect(economy.apply).not.toHaveBeenCalled();
    });

    it('记录不存在：404', async () => {
      races.findOne.mockResolvedValue(null);
      await expect(svc.doubleReward('u1', 'r9', 'n')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('settle 每日任务打点', () => {
    it('首次结算成功：赛跑任务计数 +1 且带日切过期', async () => {
      races.findOne.mockResolvedValue(
        settledRace({ status: 'pending', settledAt: null }),
      );

      await svc.settle('u1', 'r1');

      expect(redis.incr).toHaveBeenCalledWith('act:u1:20260826:race');
      expect(redis.expire).toHaveBeenCalledWith(
        'act:u1:20260826:race',
        expect.any(Number),
      );
    });

    it('重复结算（状态未流转）不再计数，否则能刷满赛跑任务', async () => {
      races.findOne.mockResolvedValue(
        settledRace({ status: 'pending', settledAt: null }),
      );
      races.update.mockResolvedValue({ affected: 0 });

      await svc.settle('u1', 'r1');

      expect(redis.incr).not.toHaveBeenCalled();
    });

    it('已结算走回放路径，不计数', async () => {
      races.findOne.mockResolvedValue(settledRace());
      await svc.settle('u1', 'r1');
      expect(redis.incr).not.toHaveBeenCalled();
    });

    it('计数器故障不影响发奖（软失败不死亡）', async () => {
      races.findOne.mockResolvedValue(
        settledRace({ status: 'pending', settledAt: null }),
      );
      redis.incr.mockRejectedValue(new Error('redis down'));

      const res = await svc.settle('u1', 'r1');
      expect(res.rewardCoin).toBe(100);
      expect(economy.apply).toHaveBeenCalled();
    });
  });

  describe('revive 复活重跑', () => {
    const pending = () =>
      settledRace({
        status: 'pending',
        settledAt: null,
        rank: 4,
        rewardCoin: 8,
      });

    it('未结算且未用过复活：核销凭证并重掷名次', async () => {
      races.findOne.mockResolvedValue(pending());

      const res = await svc.revive('u1', 'r1', 'nonce2');

      expect(adToken.consume).toHaveBeenCalledWith(
        'u1',
        'nonce2',
        'race_revive',
      );
      expect(res.previousRank).toBe(4);
      expect(res.reviveCount).toBe(1);
      expect(res.status).toBe('pending');
      expect(res.rank).toBeGreaterThanOrEqual(1);
      expect(res.rank).toBeLessThanOrEqual(res.totalRacers);
      expect(res.opponentFinishTimes).toHaveLength(res.totalRacers - 1);
      expect(res.finishTime).toBeGreaterThan(0);
      expect(['S', 'A', 'B', 'C']).toContain(res.grade);
    });

    it('重跑落库写入完赛时间与评级（不再只写战力得分）', async () => {
      races.findOne.mockResolvedValue(pending());
      await svc.revive('u1', 'r1', 'nonce2');

      const calls = races.update.mock.calls as unknown[][];
      const patch = calls[0][1] as Partial<RaceRecord>;
      expect(calls[0][0]).toEqual({
        id: 'r1',
        status: 'pending',
        reviveCount: 0,
      });
      expect(typeof patch.finishTime).toBe('number');
      expect(['S', 'A', 'B', 'C']).toContain(patch.grade);
      expect(['player', 'mixed', 'npc']).toContain(patch.ghostSource);
    });

    it('影子采样为空时退回 NPC，并标记 ghostSource=npc', async () => {
      races.findOne.mockResolvedValue(pending());
      const res = await svc.revive('u1', 'r1', 'nonce2');
      expect(res.ghostSource).toBe('npc');
    });

    it('采样到足够真实成绩时用真人影子，并按等级带/赛道过滤', async () => {
      races.findOne.mockResolvedValue(pending());
      const qb = emptySampleQb();
      qb.getRawMany.mockResolvedValue([
        { finishTime: '18.5' },
        { finishTime: '19.5' },
        { finishTime: '20.5' },
      ]);
      races.createQueryBuilder.mockReturnValue(qb);

      const res = await svc.revive('u1', 'r1', 'nonce2');

      expect(res.ghostSource).toBe('player');
      expect(res.opponentFinishTimes).toEqual([18.5, 19.5, 20.5]);
      // 只采同赛道、排除自己、跳过没有完赛时间的旧记录
      const clauses = (qb.andWhere.mock.calls as unknown[][]).map((c) =>
        String(c[0]),
      );
      expect(clauses.some((c) => c.includes('user_id <>'))).toBe(true);
      expect(clauses.some((c) => c.includes('finish_time IS NOT NULL'))).toBe(
        true,
      );
      expect(clauses.some((c) => c.includes("status = 'settled'"))).toBe(true);
      expect(clauses.some((c) => c.includes('pet_level BETWEEN'))).toBe(true);
    });

    it('采样到的异常成绩被钳进合理区间，不让刷榜号碾压新手', async () => {
      races.findOne.mockResolvedValue(pending());
      const qb = emptySampleQb();
      // 0.001 秒是不可能的成绩（改档/刷榜），必须被钳到 baseTime×clampMin 以上
      qb.getRawMany.mockResolvedValue([
        { finishTime: '0.001' },
        { finishTime: '0.002' },
        { finishTime: '999999' },
      ]);
      races.createQueryBuilder.mockReturnValue(qb);

      const res = await svc.revive('u1', 'r1', 'nonce2');
      const ghost = RACE_CONFIG['race.ghost'].default;

      for (const t of res.opponentFinishTimes) {
        expect(t).toBeGreaterThan(1);
        expect(t).toBeLessThan(1000);
      }
      // 最快的影子不会快过玩家基准时间的 clampMin 倍
      const fastest = Math.min(...res.opponentFinishTimes);
      expect(fastest).toBeGreaterThanOrEqual(
        res.finishTime * ghost.clampMin * 0.8,
      );
    });

    it('真实成绩不足 minSamples 时整场退回 NPC', async () => {
      races.findOne.mockResolvedValue(pending());
      const qb = emptySampleQb();
      qb.getRawMany.mockResolvedValue([{ finishTime: '19.0' }]);
      races.createQueryBuilder.mockReturnValue(qb);

      const res = await svc.revive('u1', 'r1', 'nonce2');
      expect(res.ghostSource).toBe('npc');
    });

    it('采样查询抛错不影响比赛（软失败不死亡）', async () => {
      races.findOne.mockResolvedValue(pending());
      races.createQueryBuilder.mockImplementation(() => {
        throw new Error('db down');
      });

      const res = await svc.revive('u1', 'r1', 'nonce2');
      expect(res.ghostSource).toBe('npc');
      expect(res.finishTime).toBeGreaterThan(0);
    });

    it('用参赛那只宠的当前战力重掷（服务端权威）', async () => {
      races.findOne.mockResolvedValue(pending());
      await svc.revive('u1', 'r1', 'nonce2');
      expect(pet.getBattleStats).toHaveBeenCalledWith('u1', 'p1');
    });

    it('重掷不扣体力、不扣门票', async () => {
      races.findOne.mockResolvedValue(pending());
      await svc.revive('u1', 'r1', 'nonce2');
      expect(economy.apply).not.toHaveBeenCalled();
    });

    it('落库条件带 reviveCount，兜住并发重掷', async () => {
      races.findOne.mockResolvedValue(pending());
      await svc.revive('u1', 'r1', 'nonce2');

      expect(races.update).toHaveBeenCalledWith(
        { id: 'r1', status: 'pending', reviveCount: 0 },
        expect.objectContaining({ reviveCount: 1 }),
      );
    });

    it('并发导致条件更新未命中：报错而非静默成功', async () => {
      races.findOne.mockResolvedValue(pending());
      races.update.mockResolvedValue({ affected: 0 });

      await expect(svc.revive('u1', 'r1', 'nonce2')).rejects.toThrow(
        '本场状态已变更，请刷新后重试',
      );
    });

    it('已结算：拒绝复活', async () => {
      races.findOne.mockResolvedValue(settledRace());

      await expect(svc.revive('u1', 'r1', 'n')).rejects.toThrow(
        '已结算的比赛不能复活重跑',
      );
      expect(adToken.consume).not.toHaveBeenCalled();
    });

    it('复活次数用尽：拒绝', async () => {
      races.findOne.mockResolvedValue(
        settledRace({
          status: 'pending',
          settledAt: null,
          reviveCount: RACE_REVIVE.maxPerRace,
        }),
      );

      await expect(svc.revive('u1', 'r1', 'n')).rejects.toThrow(
        '本场复活机会已用完',
      );
      expect(adToken.consume).not.toHaveBeenCalled();
    });

    it('凭证无效：不改名次', async () => {
      races.findOne.mockResolvedValue(pending());
      adToken.consume.mockRejectedValue(
        new BadRequestException('广告凭证无效或已过期'),
      );

      await expect(svc.revive('u1', 'r1', 'bad')).rejects.toThrow(
        '广告凭证无效或已过期',
      );
      expect(races.update).not.toHaveBeenCalled();
    });
  });
});
