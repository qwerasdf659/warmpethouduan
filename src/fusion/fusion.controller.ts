import {
  Body,
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { AuthUser } from '../auth/jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlayerStatusGuard } from '../auth/player-status.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';
import { FusionExecuteDto, FusionPreviewDto } from './dto/fusion.dto';
import { FusionService } from './fusion.service';

/** 融合（P8）。preview 纯计算无副作用不加幂等；execute 幂等且锁内二次校验。 */
@Controller('fusion')
@UseGuards(JwtAuthGuard, PlayerStatusGuard)
export class FusionController {
  constructor(private readonly fusion: FusionService) {}

  @Post('preview')
  preview(@CurrentUser() user: AuthUser, @Body() dto: FusionPreviewDto) {
    return this.fusion.preview(user.userId, dto.petIds);
  }

  @Post('execute')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  execute(@CurrentUser() user: AuthUser, @Body() dto: FusionExecuteDto) {
    return this.fusion.execute(user.userId, dto.bizId, dto.petIds);
  }
}
