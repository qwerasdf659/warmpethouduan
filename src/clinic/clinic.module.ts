import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { EconomyModule } from '../economy/economy.module';
import { Clinic } from '../entities/clinic.entity';
import { ClinicCase } from '../entities/clinic-case.entity';
import { LedgerModule } from '../ledger/ledger.module';
import { ClinicController } from './clinic.controller';
import { ClinicService } from './clinic.service';

/**
 * 兽医经营域（P7）。
 *
 * `LedgerModule` 提供 `RewardService`（接诊发币 / 解锁扣币走它，reason `clinic`）；
 * `EconomyModule` 提供钱包视图。`ClockService` / `LockService` / `GameConfigService`
 * 均为全局模块导出，无需在此 import。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Clinic, ClinicCase]),
    AuthModule,
    EconomyModule,
    LedgerModule,
  ],
  controllers: [ClinicController],
  providers: [ClinicService],
  exports: [ClinicService],
})
export class ClinicModule {}
