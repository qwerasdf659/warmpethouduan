import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { ClockService } from '../common/clock/clock.service';
import {
  businessDayKey,
  secondsUntilNextBusinessDay,
} from '../common/time/business-day';
import { EconomyService } from '../economy/economy.service';
import { PetService, PetStateView } from '../pet/pet.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { AD_REWARD, SPEEDUP, STAMINA_RECOVER } from './boost.config';

/**
 * 广告激励 / 加速 / 体力恢复。
 * - 广告奖励：账号级每日上限（Redis 计数），发币经 EconomyService（bizId 幂等）。
 * - 加速/体力恢复：先扣游戏币，再作用于宠物（PetService，玩家级锁内）。
 *
 * 注：微信激励视频无标准服务端回调票据，这里以「客户端上报 + 服务端每日限次 + 幂等」
 * 兜住刷量；若接入第三方 SSP 回调，可在 verifyAd 处校验签名后再发放。
 */
@Injectable()
export class BoostService {
  constructor(
    private readonly pet: PetService,
    private readonly economy: EconomyService,
    private readonly clock: ClockService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** 激励视频奖励发放（每日限次）。 */
  async verifyAd(
    userId: string,
    bizId: string,
  ): Promise<{ gained: number; gameCoin: number; remaining: number }> {
    const now = this.clock.now();
    const day = businessDayKey(now);
    const key = `ad:${userId}:${day}`;
    const used = parseInt((await this.redis.get(key)) ?? '0', 10);
    if (used >= AD_REWARD.dailyCap) {
      throw new BadRequestException('今日广告奖励次数已用尽');
    }

    const applied = await this.economy.apply({
      userId,
      pool: 'game',
      delta: AD_REWARD.coin,
      bizId: `ad:${bizId}`,
      reason: 'ad',
      refId: day,
    });

    // 仅首次记账才计数（幂等回放不重复计次）
    if (!applied.duplicated) {
      await this.redis.incr(key);
      await this.redis.expire(key, secondsUntilNextBusinessDay(now));
    }

    return {
      gained: AD_REWARD.coin,
      gameCoin: applied.wallet.gameCoin,
      remaining: Math.max(0, AD_REWARD.dailyCap - (used + 1)),
    };
  }

  /** 付费清冷却（加速）。 */
  async speedup(
    userId: string,
    bizId: string,
    petId?: string,
  ): Promise<{ cleared: number; gameCoin: number }> {
    const applied = await this.economy.apply({
      userId,
      pool: 'game',
      delta: -SPEEDUP.cost,
      bizId: `speedup:${bizId}`,
      reason: 'boost',
      refId: petId ?? null,
    });
    const { cleared } = await this.pet.clearCooldowns(userId, petId);
    return { cleared, gameCoin: applied.wallet.gameCoin };
  }

  /** 付费恢复满体力。 */
  async recoverStamina(
    userId: string,
    bizId: string,
    petId?: string,
  ): Promise<{ pet: PetStateView; gameCoin: number }> {
    const applied = await this.economy.apply({
      userId,
      pool: 'game',
      delta: -STAMINA_RECOVER.cost,
      bizId: `stamina:${bizId}`,
      reason: 'boost',
      refId: petId ?? null,
    });
    const { pet } = await this.pet.recoverStamina(userId, petId);
    return { pet, gameCoin: applied.wallet.gameCoin };
  }
}
