import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { EconomyModule } from '../economy/economy.module';
import { Pet } from '../entities/pet.entity';
import { PetTrick } from '../entities/pet-trick.entity';
import { HomeComfortModule } from '../home/home-comfort.module';
import { LedgerModule } from '../ledger/ledger.module';
import { TrainingController } from './training.controller';
import { TrainingService } from './training.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Pet, PetTrick]),
    AuthModule,
    EconomyModule,
    LedgerModule,
    HomeComfortModule,
  ],
  controllers: [TrainingController],
  providers: [TrainingService],
  exports: [TrainingService],
})
export class TrainingModule {}
