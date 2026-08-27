import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssetDef } from '../entities/asset-def.entity';
import { AccountService } from './account.service';
import { AssetCatalogService } from './asset-catalog.service';
import { ExpireService } from './expire.service';
import { InventoryService } from './inventory.service';
import { LedgerQueryService } from './ledger-query.service';
import { LedgerService } from './ledger.service';
import { PartitionService } from './partition.service';
import { RewardService } from './reward.service';

/**
 * 账本域。全局可用（`AppModule` 里 import），因为几乎每个玩法模块都要发奖或扣费。
 *
 * 刻意**不**导出实体仓库：账本表的写入只能经 `LedgerService`，
 * 若把 `Repository<AssetBalance>` 也导出去，早晚有人图省事直接 `save()` 改余额，
 * 而那条路径没有分录、没有幂等、没有批次分摊。
 */
@Module({
  imports: [TypeOrmModule.forFeature([AssetDef])],
  providers: [
    AccountService,
    LedgerService,
    LedgerQueryService,
    RewardService,
    InventoryService,
    AssetCatalogService,
    ExpireService,
    PartitionService,
  ],
  exports: [
    AccountService,
    LedgerService,
    RewardService,
    InventoryService,
    AssetCatalogService,
    ExpireService,
  ],
})
export class LedgerModule {}
