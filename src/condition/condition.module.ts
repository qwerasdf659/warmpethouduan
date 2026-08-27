import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { EconomyModule } from '../economy/economy.module';
import { Pet } from '../entities/pet.entity';
import { PetCondition } from '../entities/pet-condition.entity';
import { LedgerModule } from '../ledger/ledger.module';
import { PetModule } from '../pet/pet.module';
import { ConditionController } from './condition.controller';
import { ConditionService } from './condition.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PetCondition, Pet]),
    AuthModule,
    EconomyModule,
    LedgerModule,
    PetModule,
  ],
  controllers: [ConditionController],
  providers: [ConditionService],
  exports: [ConditionService],
})
export class ConditionModule {}
