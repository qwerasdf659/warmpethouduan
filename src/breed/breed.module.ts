import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { BoostModule } from '../boost/boost.module';
import { EconomyModule } from '../economy/economy.module';
import { Pet } from '../entities/pet.entity';
import { PetEgg } from '../entities/pet-egg.entity';
import { HomeComfortModule } from '../home/home-comfort.module';
import { LedgerModule } from '../ledger/ledger.module';
import { BreedController } from './breed.controller';
import { BreedService } from './breed.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Pet, PetEgg]),
    AuthModule,
    EconomyModule,
    LedgerModule,
    HomeComfortModule,
    BoostModule,
  ],
  controllers: [BreedController],
  providers: [BreedService],
  exports: [BreedService],
})
export class BreedModule {}
