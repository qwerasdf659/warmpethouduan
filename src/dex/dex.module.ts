import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { EconomyModule } from '../economy/economy.module';
import { ItemsModule } from '../items/items.module';
import { PetModule } from '../pet/pet.module';
import { DexClaim } from '../entities/dex-claim.entity';
import { DexController } from './dex.controller';
import { DexService } from './dex.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([DexClaim]),
    AuthModule,
    EconomyModule,
    PetModule,
    ItemsModule,
  ],
  controllers: [DexController],
  providers: [DexService],
  exports: [DexService],
})
export class DexModule {}
