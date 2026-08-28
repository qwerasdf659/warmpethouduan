import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/jwt-auth.guard';
import { PlayerStatusGuard } from '../auth/player-status.guard';
import { BuyItemDto, EquipDto, UnequipDto } from './dto/wardrobe.dto';
import { WardrobeService } from './wardrobe.service';

// 与 items/consumables 同属 items 模块，统一挂在 items/ 下，
// 免得同一个背包域一半在 /items 一半在顶级 /wardrobe。
@Controller('items/wardrobe')
@UseGuards(JwtAuthGuard, PlayerStatusGuard)
export class WardrobeController {
  constructor(private readonly wardrobe: WardrobeService) {}

  /** 换装商店 + 拥有/穿戴态。 */
  @Get()
  list(@CurrentUser() user: AuthUser, @Query('petId') petId?: string) {
    return this.wardrobe.list(user.userId, petId);
  }

  @Post('buy')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  buy(@CurrentUser() user: AuthUser, @Body() dto: BuyItemDto) {
    return this.wardrobe.buy(user.userId, dto.assetCode, dto.bizId);
  }

  @Post('equip')
  equip(@CurrentUser() user: AuthUser, @Body() dto: EquipDto) {
    return this.wardrobe.equip(user.userId, dto.assetCode, dto.petId);
  }

  @Post('unequip')
  unequip(@CurrentUser() user: AuthUser, @Body() dto: UnequipDto) {
    return this.wardrobe.unequip(user.userId, dto.slot, dto.petId);
  }
}
