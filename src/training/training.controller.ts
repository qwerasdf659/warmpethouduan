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
import { TricksQueryDto, TrickActionDto } from './dto/training.dto';
import { TrainingService } from './training.service';

/** 训练技巧（P13）。 */
@Controller('training')
@UseGuards(JwtAuthGuard, PlayerStatusGuard)
export class TrainingController {
  constructor(private readonly training: TrainingService) {}

  @Get('tricks')
  tricks(@CurrentUser() user: AuthUser, @Query() q: TricksQueryDto) {
    return this.training.listTricks(user.userId, q.petId);
  }

  @Post('practice')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  practice(@CurrentUser() user: AuthUser, @Body() dto: TrickActionDto) {
    return this.training.practice(
      user.userId,
      dto.bizId,
      dto.trickKey,
      dto.petId,
    );
  }

  @Post('perform')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  perform(@CurrentUser() user: AuthUser, @Body() dto: TrickActionDto) {
    return this.training.perform(
      user.userId,
      dto.bizId,
      dto.trickKey,
      dto.petId,
    );
  }
}
