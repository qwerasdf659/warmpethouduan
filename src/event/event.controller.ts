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
import { EventClaimDto, EventProgressQueryDto } from './dto/event.dto';
import { EventService } from './event.service';

/** 限时活动玩家端（P12）。 */
@Controller('event')
@UseGuards(JwtAuthGuard, PlayerStatusGuard)
export class EventController {
  constructor(private readonly event: EventService) {}

  /** 当前开放中的活动。 */
  @Get('current')
  current() {
    return this.event.current();
  }

  /** 某活动的任务进度。 */
  @Get('progress')
  progress(@CurrentUser() user: AuthUser, @Query() q: EventProgressQueryDto) {
    return this.event.progressOf(user.userId, q.eventKey);
  }

  /** 领取活动任务奖励。 */
  @Post('claim')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  claim(@CurrentUser() user: AuthUser, @Body() dto: EventClaimDto) {
    return this.event.claim(user.userId, {
      bizId: dto.bizId,
      eventKey: dto.eventKey,
      taskKey: dto.taskKey,
    });
  }
}
