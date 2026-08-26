import { BadRequestException } from '@nestjs/common';
import Redis from 'ioredis';
import { ClockService } from '../common/clock/clock.service';
import { GameConfigService } from '../config/game-config.service';
import { EconomyService } from '../economy/economy.service';
import { PetService } from '../pet/pet.service';
import { AdTokenService } from './ad-token.service';
import { BOOST_CONFIG } from './boost.config';
import { BoostService } from './boost.service';

/**
 * 广告奖励的风控约束。
 *
 * 重点是「没有有效凭证就不许发币」：这个接口曾经只校验每日次数，
 * 等于客户端说看了广告就给，持 JWT 循环调用即可刷满日上限。
 */
describe('BoostService 广告奖励风控', () => {
  const AD_REWARD = BOOST_CONFIG['boost.ad_reward'].default;

  interface EconomyStub {
    apply: jest.Mock;
  }
  interface AdTokenStub {
    consume: jest.Mock;
  }
  type RedisStub = Partial<Record<'get' | 'incr' | 'expire', jest.Mock>>;

  let economy: EconomyStub;
  let adToken: AdTokenStub;
  let redis: RedisStub;
  let svc: BoostService;

  const clock: ClockService = {
    now: () => new Date('2026-01-01T04:00:00Z'),
    nowMs: () => 0,
  };
  const config = {
    get: () => Promise.resolve(AD_REWARD),
  } as unknown as GameConfigService;

  beforeEach(() => {
    economy = {
      apply: jest.fn(() =>
        Promise.resolve({
          wallet: { gameCoin: 130, marketingPoint: 0 },
          entry: {},
          duplicated: false,
        }),
      ),
    };
    adToken = { consume: jest.fn(() => Promise.resolve(undefined)) };
    redis = {
      get: jest.fn(() => Promise.resolve('0')),
      incr: jest.fn(() => Promise.resolve(1)),
      expire: jest.fn(() => Promise.resolve(1)),
    };

    svc = new BoostService(
      {} as unknown as PetService,
      economy as unknown as EconomyService,
      clock,
      config,
      adToken as unknown as AdTokenService,
      redis as unknown as Redis,
    );
  });

  it('凭证有效：核销后发币，且核销的 scene 是 ad_reward', async () => {
    const res = await svc.verifyAd('u1', 'b1', 'nonce-1');

    expect(adToken.consume).toHaveBeenCalledWith('u1', 'nonce-1', 'ad_reward');
    expect(economy.apply).toHaveBeenCalledWith(
      expect.objectContaining({ bizId: 'ad:b1', delta: AD_REWARD.coin }),
    );
    expect(res.gained).toBe(AD_REWARD.coin);
  });

  it('凭证无效：直接抛错且**不发币**', async () => {
    adToken.consume.mockRejectedValue(
      new BadRequestException('广告凭证无效或已过期'),
    );

    await expect(svc.verifyAd('u1', 'b1', 'bad')).rejects.toThrow(
      '广告凭证无效或已过期',
    );
    expect(economy.apply).not.toHaveBeenCalled();
  });

  it('已达每日上限：先拒绝，不白烧一枚凭证', async () => {
    redis.get = jest.fn(() => Promise.resolve(String(AD_REWARD.dailyCap)));

    await expect(svc.verifyAd('u1', 'b1', 'nonce-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(adToken.consume).not.toHaveBeenCalled();
    expect(economy.apply).not.toHaveBeenCalled();
  });

  it('幂等回放（同 bizId）：不重复计入每日次数', async () => {
    economy.apply.mockResolvedValue({
      wallet: { gameCoin: 130, marketingPoint: 0 },
      entry: {},
      duplicated: true,
    });

    await svc.verifyAd('u1', 'b1', 'nonce-1');

    expect(redis.incr).not.toHaveBeenCalled();
  });
});
