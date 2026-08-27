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
import { PaginationDto } from '../common/dto/pagination.dto';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';
import { ChallengeDto, HistoryQueryDto } from './dto/pvp.dto';
import { PvpService } from './pvp.service';

/** 异步 PvP 天梯（P4）。 */
@Controller('pvp')
@UseGuards(JwtAuthGuard, PlayerStatusGuard)
export class PvpController {
  constructor(private readonly pvp: PvpService) {}

  @Get('opponents')
  opponents(@CurrentUser() user: AuthUser) {
    return this.pvp.opponents(user.userId);
  }

  @Post('challenge')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  challenge(@CurrentUser() user: AuthUser, @Body() dto: ChallengeDto) {
    return this.pvp.challenge(
      user.userId,
      dto.bizId,
      dto.opponentUserId,
      dto.trackKey,
    );
  }

  @Get('rank')
  rank(@CurrentUser() user: AuthUser, @Query() q: PaginationDto) {
    return this.pvp.rank(user.userId, q.page ?? 1, q.pageSize ?? 20);
  }

  @Get('history')
  history(@CurrentUser() user: AuthUser, @Query() q: HistoryQueryDto) {
    return this.pvp.history(
      user.userId,
      q.page ?? 1,
      q.pageSize ?? 20,
      q.role ?? 'challenger',
    );
  }
}
