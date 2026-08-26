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
import { DrawGachaDto, GachaHistoryQueryDto } from './dto/gacha.dto';
import { GachaService } from './gacha.service';

@Controller('gacha')
@UseGuards(JwtAuthGuard, PlayerStatusGuard)
export class GachaController {
  constructor(private readonly gacha: GachaService) {}

  /**
   * 奖池 + **概率公示** + 我的保底进度。
   *
   * 概率来自服务端实际使用的那份权重，不存在「展示一套、跑另一套」的可能。
   * 前端有义务把 `odds` 展示出来（虚拟道具抽取的合规要求）。
   */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.gacha.list(user.userId);
  }

  @Get('history')
  history(@CurrentUser() user: AuthUser, @Query() query: GachaHistoryQueryDto) {
    return this.gacha.myDraws(
      user.userId,
      query.page ?? 1,
      query.pageSize ?? 20,
    );
  }

  @Post('draw')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  draw(@CurrentUser() user: AuthUser, @Body() dto: DrawGachaDto) {
    return this.gacha.draw(user.userId, dto.poolKey, dto.times ?? 1, dto.bizId);
  }
}
