import { BadRequestException, NotFoundException } from '@nestjs/common';
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
}
interface PetStub {
  getBattleStats: jest.Mock;
}
interface EconomyStub {
  apply: jest.Mock;
  getWallet: jest.Mock;
}
interface AdTokenStub {
  consume: jest.Mock;
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
  let svc: RaceService;

  /** 一场已结算、名次 2、奖励 100 的比赛。 */
  function settledRace(over: Partial<RaceRecord> = {}): RaceRecord {
    return {
      id: 'r1',
      userId: 'u1',
      petId: 'p1',
      trackKey: 'meadow',
      petLevel: 3,
      score: 100,
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

  beforeEach(() => {
    races = {
      findOne: jest.fn(),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
      save: jest.fn(),
      create: jest.fn(),
    };
    pet = {
      getBattleStats: jest.fn(() =>
        Promise.resolve({
          petId: 'p1',
          nickname: null,
          level: 3,
          speed: 12,
          endurance: 11.6,
          stamina: 60,
          staminaMax: 104,
        }),
      ),
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

    svc = new RaceService(
      races as unknown as Repository<RaceRecord>,
      pet as unknown as PetService,
      economy as unknown as EconomyService,
      // 本组用例只走 doubleReward / revive，二者都不读时钟
      {} as unknown as ClockService,
      adToken as unknown as AdTokenService,
      configStub,
    );
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
      expect(res.opponentScores).toHaveLength(res.totalRacers - 1);
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
