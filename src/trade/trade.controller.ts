import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { AuthUser } from '../auth/jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlayerStatusGuard } from '../auth/player-status.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';
import {
  TradeCancelDto,
  TradeInboxDto,
  TradeOfferDto,
  TradeRespondDto,
} from './dto/trade.dto';
import { TradeService } from './trade.service';

/** 双向易货（barter）。建单/接受受 market 总闸约束；撤销/拒绝/超时为退出通道不受约束。 */
@Controller('trade')
@UseGuards(JwtAuthGuard, PlayerStatusGuard)
export class TradeController {
  constructor(private readonly trade: TradeService) {}

  @Post('offer')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  offer(@CurrentUser() user: AuthUser, @Body() dto: TradeOfferDto) {
    return this.trade.offer(
      user.userId,
      dto.bizId,
      dto.toUserId,
      dto.fromItems,
      dto.toItems,
      dto.fromCoin ?? 0,
      dto.toCoin ?? 0,
    );
  }

  @Post('respond')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  respond(@CurrentUser() user: AuthUser, @Body() dto: TradeRespondDto) {
    return this.trade.respond(user.userId, dto.bizId, dto.offerId, dto.action);
  }

  @Post('cancel')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  cancel(@CurrentUser() user: AuthUser, @Body() dto: TradeCancelDto) {
    return this.trade.cancel(user.userId, dto.bizId, dto.offerId);
  }

  @Get('inbox')
  inbox(@CurrentUser() user: AuthUser, @Query() q: TradeInboxDto) {
    return this.trade.inbox(
      user.userId,
      q.box ?? 'incoming',
      q.page ?? 1,
      q.pageSize ?? 20,
    );
  }
}
