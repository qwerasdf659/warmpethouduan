import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { EconomyModule } from '../economy/economy.module';
import { ItemDef } from '../entities/item-def.entity';
import { ItemOwned } from '../entities/item-owned.entity';
import { PetEquip } from '../entities/pet-equip.entity';
import { Pet } from '../entities/pet.entity';
import { ItemsService } from './items.service';
import { WardrobeService } from './wardrobe.service';
import { WardrobeController } from './wardrobe.controller';

/**
 * 物品域：物品定义/背包/购买（ItemsService，供换装与家园共用）+ 换装玩法。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ItemDef, ItemOwned, PetEquip, Pet]),
    AuthModule,
    EconomyModule,
  ],
  controllers: [WardrobeController],
  providers: [ItemsService, WardrobeService],
  exports: [ItemsService],
})
export class ItemsModule {}
