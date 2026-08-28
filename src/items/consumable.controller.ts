import {
  Body,
  Controller,
  Get,
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
import { ConsumableService } from './consumable.service';
import { BuyConsumableDto, UseConsumableDto } from './dto/consumable.dto';

/**
 * 消耗品商店。路径用 `/items/consumables/*` 而不是复用 `/wardrobe/buy`：
 * 换装与家园的 buy 是按玩法分的入口，消耗品不属于任何一个玩法界面。
 */
@Controller('items/consumables')
@UseGuards(JwtAuthGuard, PlayerStatusGuard)
export class ConsumableController {
  constructor(private readonly consumables: ConsumableService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.consumables.list(user.userId);
  }

  @Post('buy')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  buy(@CurrentUser() user: AuthUser, @Body() dto: BuyConsumableDto) {
    return this.consumables.buy(
      user.userId,
      dto.assetCode,
      dto.qty ?? 1,
      dto.bizId,
    );
  }

  @Post('use')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  use(@CurrentUser() user: AuthUser, @Body() dto: UseConsumableDto) {
    return this.consumables.use(
      user.userId,
      dto.assetCode,
      dto.bizId,
      dto.petId,
    );
  }
}
