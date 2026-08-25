import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/jwt-auth.guard';
import { RaceAdBoostDto, RaceSettleDto, RaceStartDto } from './dto/race.dto';
import { RaceService } from './race.service';

@Controller('race')
@UseGuards(JwtAuthGuard)
export class RaceController {
  constructor(private readonly race: RaceService) {}

  /** 赛道列表 + 当前战力预览。 */
  @Get('tracks')
  tracks(@CurrentUser() user: AuthUser) {
    return this.race.listTracks(user.userId);
  }

  /** 报名参赛（扣体力/门票，服务端算定名次）。 */
  @Post('start')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  start(@CurrentUser() user: AuthUser, @Body() dto: RaceStartDto) {
    return this.race.start(user.userId, dto.trackKey, dto.bizId, dto.petId);
  }

  /** 结算领奖。 */
  @Post('settle')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  settle(@CurrentUser() user: AuthUser, @Body() dto: RaceSettleDto) {
    return this.race.settle(user.userId, dto.raceId);
  }

  /** 看广告奖励翻倍（需先 `POST /ad/token` 领 scene=race_double 的凭证）。 */
  @Post('reward/double')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  rewardDouble(@CurrentUser() user: AuthUser, @Body() dto: RaceAdBoostDto) {
    return this.race.doubleReward(user.userId, dto.raceId, dto.adToken);
  }

  /** 看广告复活重跑（需先 `POST /ad/token` 领 scene=race_revive 的凭证）。 */
  @Post('revive')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  revive(@CurrentUser() user: AuthUser, @Body() dto: RaceAdBoostDto) {
    return this.race.revive(user.userId, dto.raceId, dto.adToken);
  }
}
