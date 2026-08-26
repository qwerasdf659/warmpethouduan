import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { EconomyModule } from '../economy/economy.module';
import { GachaDraw } from '../entities/gacha-draw.entity';
import { GachaState } from '../entities/gacha-state.entity';
import { LedgerModule } from '../ledger/ledger.module';
import { GachaController } from './gacha.controller';
import { GachaService } from './gacha.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([GachaDraw, GachaState]),
    AuthModule,
    EconomyModule,
    // 扣费 + 发奖合成一张凭证，直接用账本域而不再经 ItemsService
    LedgerModule,
  ],
  controllers: [GachaController],
  providers: [GachaService],
  exports: [GachaService],
})
export class GachaModule {}
