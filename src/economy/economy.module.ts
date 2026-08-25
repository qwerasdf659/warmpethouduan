import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Ledger } from '../entities/ledger.entity';
import { Wallet } from '../entities/wallet.entity';
import { EconomyController } from './economy.controller';
import { EconomyService } from './economy.service';

@Module({
  imports: [TypeOrmModule.forFeature([Wallet, Ledger]), AuthModule],
  controllers: [EconomyController],
  providers: [EconomyService],
  exports: [EconomyService],
})
export class EconomyModule {}
