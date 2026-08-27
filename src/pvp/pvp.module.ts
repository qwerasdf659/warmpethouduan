import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { EconomyModule } from '../economy/economy.module';
import { Pet } from '../entities/pet.entity';
import { PetEquip } from '../entities/pet-equip.entity';
import { PvpMatch } from '../entities/pvp-match.entity';
import { PvpRank } from '../entities/pvp-rank.entity';
import { LedgerModule } from '../ledger/ledger.module';
import { PetModule } from '../pet/pet.module';
import { PetBonusModule } from '../pet-bonus/pet-bonus.module';
import { PvpController } from './pvp.controller';
import { PvpService } from './pvp.service';
import { PvpSeasonService } from './pvp-season.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PvpRank, PvpMatch, Pet, PetEquip]),
    AuthModule,
    EconomyModule,
    LedgerModule,
    PetModule,
    PetBonusModule,
  ],
  controllers: [PvpController],
  providers: [PvpService, PvpSeasonService],
  exports: [PvpService],
})
export class PvpModule {}
