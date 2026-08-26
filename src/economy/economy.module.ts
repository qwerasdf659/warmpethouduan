import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LedgerModule } from '../ledger/ledger.module';
import { EconomyController } from './economy.controller';
import { EconomyService } from './economy.service';
import { ReconcileService } from './reconcile.service';

/**
 * 经济域。重构后这里不再持有任何实体仓库 —— 余额与流水都在 `LedgerModule`，
 * 本模块只提供货币视角的门面（`EconomyService`）与对账作业。
 */
@Module({
  imports: [LedgerModule, AuthModule],
  controllers: [EconomyController],
  providers: [EconomyService, ReconcileService],
  exports: [EconomyService, ReconcileService],
})
export class EconomyModule {}
