import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../auth/jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlayerStatusGuard } from '../auth/player-status.guard';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';
import { PromoService } from './promo.service';
import { MyRedemptionQueryDto, RedeemPromoDto } from './dto/promo.dto';

/** 兑换码：玩家侧核销入口（营销积分靠它入账）。 */
@Controller('promo')
@UseGuards(JwtAuthGuard, PlayerStatusGuard)
export class PromoController {
  constructor(private readonly promo: PromoService) {}

  @Get('redemptions')
  myRedemptions(
    @CurrentUser() user: AuthUser,
    @Query() q: MyRedemptionQueryDto,
  ) {
    return this.promo.myRedemptions(user.userId, q.page, q.pageSize);
  }

  @Post('redeem')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  redeem(@CurrentUser() user: AuthUser, @Body() dto: RedeemPromoDto) {
    return this.promo.redeem(user.userId, dto.code);
  }
}
