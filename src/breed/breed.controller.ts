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
import { BreedService } from './breed.service';
import { BreedHatchDto, BreedSpeedupDto, BreedStartDto } from './dto/breed.dto';

/** 繁殖遗传（P3）。 */
@Controller('breed')
@UseGuards(JwtAuthGuard, PlayerStatusGuard)
export class BreedController {
  constructor(private readonly breed: BreedService) {}

  @Post('start')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  start(@CurrentUser() user: AuthUser, @Body() dto: BreedStartDto) {
    return this.breed.start(user.userId, dto.bizId, dto.petAId, dto.petBId);
  }

  @Get('eggs')
  eggs(@CurrentUser() user: AuthUser, @Query() q: PaginationDto) {
    return this.breed.listEggs(user.userId, q.page ?? 1, q.pageSize ?? 20);
  }

  @Post('speedup')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  speedup(@CurrentUser() user: AuthUser, @Body() dto: BreedSpeedupDto) {
    return this.breed.speedup(
      user.userId,
      dto.bizId,
      dto.eggId,
      dto.method,
      dto.adToken,
    );
  }

  @Post('hatch')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  hatch(@CurrentUser() user: AuthUser, @Body() dto: BreedHatchDto) {
    return this.breed.hatch(user.userId, dto.bizId, dto.eggId);
  }
}
