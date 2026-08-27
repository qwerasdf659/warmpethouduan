import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { HomeLayout } from '../entities/home-layout.entity';
import { PetEquip } from '../entities/pet-equip.entity';
import { LedgerModule } from '../ledger/ledger.module';
import { HoldingCleanupService } from './holding-cleanup.service';
import { MarketController } from './market.controller';
import { MarketQueryService } from './market-query.service';
import { MarketSettleService } from './market-settle.service';
import { MarketService } from './market.service';
import { TradeRiskService } from './trade-risk.service';
import { TradeSettlementService } from './trade-settlement.service';

/**
 * 交易市场域（架构设计的期 2~5）。
 *
 * 只依赖 `LedgerModule` 与两张「离手清理」用的表，**不依赖** ItemsModule /
 * HomeModule：那两个模块的依赖链会把宠物域整条拖进来（ItemsModule → PetModule），
 * 而市场需要的只是「把卖掉的东西从穿戴和摆放里摘掉」这一件事。
 * 见 `HoldingCleanupService` 的类注释。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PetEquip, HomeLayout]),
    AuthModule,
    LedgerModule,
  ],
  controllers: [MarketController],
  providers: [
    MarketService,
    MarketQueryService,
    TradeRiskService,
    TradeSettlementService,
    HoldingCleanupService,
    MarketSettleService,
  ],
  exports: [MarketService, TradeRiskService],
})
export class MarketModule {}
