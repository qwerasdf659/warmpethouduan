import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { EconomyModule } from '../economy/economy.module';
import { PetModule } from '../pet/pet.module';
import { ItemDef } from '../entities/item-def.entity';
import { ItemOwned } from '../entities/item-owned.entity';
import { PetEquip } from '../entities/pet-equip.entity';
import { Pet } from '../entities/pet.entity';
import { ConsumableController } from './consumable.controller';
import { ConsumableService } from './consumable.service';
import { ItemsService } from './items.service';
import { WardrobeService } from './wardrobe.service';
import { WardrobeController } from './wardrobe.controller';

/**
 * 物品域：物品定义/背包/购买（ItemsService，供换装与家园共用）+ 换装玩法
 * + 消耗品（ConsumableService，可重复消耗的经济 sink）。
 *
 * 依赖 PetModule 只为消耗品施加增益；`ItemsService` 本身刻意不碰宠物，
 * 这样后台/兑换/图鉴引用它时不会被迫拖上整个宠物域。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ItemDef, ItemOwned, PetEquip, Pet]),
    AuthModule,
    EconomyModule,
    PetModule,
  ],
  controllers: [WardrobeController, ConsumableController],
  providers: [ItemsService, WardrobeService, ConsumableService],
  exports: [ItemsService, ConsumableService],
})
export class ItemsModule {}
