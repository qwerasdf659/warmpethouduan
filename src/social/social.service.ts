import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClockService } from '../common/clock/clock.service';
import { businessDayKey } from '../common/time/business-day';
import { GameConfigService } from '../config/game-config.service';
import { HomeLike } from '../entities/home-like.entity';
import { GAME_COIN } from '../ledger/ledger.types';
import { RewardService } from '../ledger/reward.service';
import { HomeService } from '../home/home.service';
import { PetService } from '../pet/pet.service';

@Injectable()
export class SocialService {
  constructor(
    @InjectRepository(HomeLike)
    private readonly likes: Repository<HomeLike>,
    private readonly home: HomeService,
    private readonly pet: PetService,
    private readonly reward: RewardService,
    private readonly config: GameConfigService,
    private readonly clock: ClockService,
  ) {}

  /** GET /home/visit/:userId：只读窥视对方家园 + 出战宠，不暴露钱包/库存/地址。 */
  async visit(viewerId: string, targetUserId: string) {
    const now = this.clock.now();
    const day = businessDayKey(now);
    const view = await this.home.getHome(targetUserId);
    const pets = await this.pet.peekPets(targetUserId);
    const active = pets.find((p) => p.isActive) ?? pets[0] ?? null;
    const likes = await this.likes.count({ where: { toUserId: targetUserId } });
    const likedToday =
      (await this.likes.count({
        where: { fromUserId: viewerId, toUserId: targetUserId, likeDay: day },
      })) > 0;
    return {
      nickname: active?.nickname ?? null,
      comfort: view.comfort,
      grid: view.grid,
      placed: view.placed,
      pet: active,
      likes,
      likedToday,
    };
  }

  /** POST /home/like：每人每天对同一目标一次，给被访问者发币。 */
  async like(
    viewerId: string,
    targetUserId: string,
    bizId: string,
  ): Promise<{ likes: number; gained: number; duplicated: boolean }> {
    if (viewerId === targetUserId) {
      throw new BadRequestException('不能给自己点赞');
    }
    const now = this.clock.now();
    const day = businessDayKey(now);
    const reward = (await this.config.get('home.visit')).likeRewardCoin;

    const already = await this.likes.findOne({
      where: { fromUserId: viewerId, toUserId: targetUserId, likeDay: day },
    });
    if (already) {
      const likes = await this.likes.count({
        where: { toUserId: targetUserId },
      });
      return { likes, gained: 0, duplicated: true };
    }

    try {
      await this.likes.save(
        this.likes.create({
          fromUserId: viewerId,
          toUserId: targetUserId,
          likeDay: day,
        }),
      );
    } catch {
      // 并发下另一个请求先插入：视为已点赞
      const likes = await this.likes.count({
        where: { toUserId: targetUserId },
      });
      return { likes, gained: 0, duplicated: true };
    }

    // 发给被访问者（scope 'sys'：发起人不是收款人，bizId 由服务端派生）
    if (reward > 0) {
      await this.reward.grant(
        targetUserId,
        [{ assetCode: GAME_COIN, count: reward }],
        {
          reason: 'visit',
          bizKey: `visit:${viewerId}:${targetUserId}:${day}`,
          scope: 'sys',
        },
      );
    }
    void bizId;
    const likes = await this.likes.count({ where: { toUserId: targetUserId } });
    return { likes, gained: reward, duplicated: false };
  }
}
