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
import { DexClaimDto } from './dto/dex.dto';
import { DexService } from './dex.service';

@Controller('dex')
@UseGuards(JwtAuthGuard, PlayerStatusGuard)
export class DexController {
  constructor(private readonly dex: DexService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.dex.getDex(user.userId);
  }

  @Post('claim')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  claim(@CurrentUser() user: AuthUser, @Body() dto: DexClaimDto) {
    return this.dex.claim(user.userId, dto.entryKey);
  }
}
