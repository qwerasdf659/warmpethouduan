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
import { PlayerStatusGuard } from '../auth/player-status.guard';
import { CheckinDto, ClaimTaskDto } from './dto/daily.dto';
import { DailyService } from './daily.service';

@Controller('daily')
@UseGuards(JwtAuthGuard, PlayerStatusGuard)
export class DailyController {
  constructor(private readonly daily: DailyService) {}

  /** 签到状态 + 每日任务列表。 */
  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.daily.getDaily(user.userId);
  }

  @Post('checkin')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  checkin(@CurrentUser() user: AuthUser, @Body() _dto: CheckinDto) {
    return this.daily.checkin(user.userId);
  }

  @Post('task/claim')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  claim(@CurrentUser() user: AuthUser, @Body() dto: ClaimTaskDto) {
    return this.daily.claimTask(user.userId, dto.taskKey);
  }
}
