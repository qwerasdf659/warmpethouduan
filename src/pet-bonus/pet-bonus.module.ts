import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssetDef } from '../entities/asset-def.entity';
import { Pet } from '../entities/pet.entity';
import { PetCondition } from '../entities/pet-condition.entity';
import { PetEquip } from '../entities/pet-equip.entity';
import { PetTrick } from '../entities/pet-trick.entity';
import { PetBonusService } from './pet-bonus.service';

/**
 * 加成/减益聚合层。独立成模块以便 PetModule / RaceModule / 各玩法域复用，
 * 且不与它们形成循环依赖（本模块只依赖实体与配置）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Pet, PetCondition, PetEquip, PetTrick, AssetDef]),
  ],
  providers: [PetBonusService],
  exports: [PetBonusService],
})
export class PetBonusModule {}
