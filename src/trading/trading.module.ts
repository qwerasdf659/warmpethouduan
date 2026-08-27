import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HomeLayout } from '../entities/home-layout.entity';
import { PetEquip } from '../entities/pet-equip.entity';
import { LedgerModule } from '../ledger/ledger.module';
import { HoldingCleanupService } from './holding-cleanup.service';
import { SubjectResolverService } from './subject-resolver.service';
import { TradeRiskService } from './trade-risk.service';

/**
 * 玩家间流转的共享闸门层。
 *
 * `MarketModule`（回收/赠送/挂单/竞价）与 `TradeModule`（易货）都依赖它，
 * 而它只依赖 `LedgerModule`。这个方向不能反过来：一旦让易货去 import 市场，
 * 两个平级玩法域就绑死了，且 madge 的循环依赖闸迟早会被触发。
 *
 * 三件事必须放在这里而不是任一玩法域里，因为**每条流转路径都要过同一套闸**：
 *  - `SubjectResolverService`：标的的归属、状态、冷却、可交易性；
 *  - `TradeRiskService`：分档开关、账号年龄、日额度、限价、净流出告警；
 *  - `HoldingCleanupService`：物品离手后收敛穿戴与摆放。
 * 任何一项在某条路径上缺席，那条路径就是绕过红线的通道。
 */
@Module({
  imports: [TypeOrmModule.forFeature([PetEquip, HomeLayout]), LedgerModule],
  providers: [SubjectResolverService, TradeRiskService, HoldingCleanupService],
  exports: [SubjectResolverService, TradeRiskService, HoldingCleanupService],
})
export class TradingModule {}
