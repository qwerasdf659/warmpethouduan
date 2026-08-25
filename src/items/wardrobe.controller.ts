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

@Controller('wardrobe')
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
    return this.wardrobe.buy(user.userId, dto.itemKey, dto.bizId);
  }

  @Post('equip')
  equip(@CurrentUser() user: AuthUser, @Body() dto: EquipDto) {
    return this.wardrobe.equip(user.userId, dto.itemKey, dto.petId);
  }

  @Post('unequip')
  unequip(@CurrentUser() user: AuthUser, @Body() dto: UnequipDto) {
    return this.wardrobe.unequip(user.userId, dto.slot, dto.petId);
  }
}
