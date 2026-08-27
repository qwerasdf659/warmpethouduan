import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import { ClockService } from '../common/clock/clock.service';
import { BUSINESS_TZ } from '../common/time/business-day';
import { GameConfigService } from '../config/game-config.service';
import { PvpRank } from '../entities/pvp-rank.entity';
import { GAME_COIN } from '../ledger/ledger.types';
import { RewardService } from '../ledger/reward.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { prevSeasonOf } from './pvp.config';

/**
 * PvP 赛季结算（P4）。
 *
 * 赛季按自然季度自动切换（`seasonOf`），榜单天然重置。本服务负责「上一季度结束后
 * 按名次发奖」这一步：每日 05:00 扫描上一季度的榜单，向前 topRatio 玩家发奖，
 * 用 Redis 标记「该季度已结算」保证只发一次（幂等，避免重复发奖）。
 *
 * 放 05:00 是避开 04:00–04:30 的对账/过期/净流出重活窗口。发奖走 RewardService（reason `pvp`），
 * bizKey 含赛季与 userId，双层幂等。
 */
@Injectable()
export class PvpSeasonService {
  private readonly logger = new Logger('PvpSeason');

  constructor(
    @InjectRepository(PvpRank) private readonly ranks: Repository<PvpRank>,
    private readonly reward: RewardService,
    private readonly config: GameConfigService,
    private readonly clock: ClockService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Cron('0 5 * * *', { name: 'pvp-season-settle', timeZone: BUSINESS_TZ })
  async settlePreviousSeason(): Promise<void> {
    const now = this.clock.now();
    const season = prevSeasonOf(now);
    const settledKey = `pvp:season:settled:${season}`;
    // 已结算过则跳过（TTL 400 天，跨季度足够）
    if (await this.redis.get(settledKey)) return;

    const rows = await this.ranks.find({
      where: { season },
      order: { rankPoint: 'DESC', updatedAt: 'ASC' },
    });
    if (rows.length === 0) {
      // 无该季度数据：仍打标，避免每天空扫
      await this.redis.set(settledKey, '1', 'EX', 400 * 86400);
      return;
    }

    const { rewards } = await this.config.get('pvp.season');
    const count = rows.length;
    let granted = 0;
    for (const tier of rewards) {
      const topN = Math.max(0, Math.ceil(tier.topRatio * count));
      for (let i = 0; i < topN && i < rows.length; i += 1) {
        if (tier.coin <= 0) continue;
        await this.reward.grant(
          rows[i].userId,
          [{ assetCode: GAME_COIN, count: tier.coin }],
          {
            reason: 'pvp',
            bizKey: `season:${season}:${rows[i].userId}`,
            scope: 'sys',
          },
        );
        granted += 1;
      }
    }
    await this.redis.set(settledKey, '1', 'EX', 400 * 86400);
    this.logger.log(`赛季 ${season} 结算发奖：${granted} 人`);
  }
}
