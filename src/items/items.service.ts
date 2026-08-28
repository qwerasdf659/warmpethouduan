import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EconomyService, WalletView } from '../economy/economy.service';
import {
  AssetCatalogService,
  AssetView,
  ItemType,
} from '../ledger/asset-catalog.service';
import { InventoryService } from '../ledger/inventory.service';
import { RewardService } from '../ledger/reward.service';
import type { LedgerReason } from '../ledger/ledger.types';

export interface BuyResult {
  assetCode: string;
  qty: number;
  wallet: WalletView;
  duplicated: boolean;
  /** 唯一物品：本次买到的实例编号（不限量则为 null） */
  serial: number | null;
}

/**
 * 物品域公共服务：目录读取、持有查询、购买（唯一扣费入口）。
 * 换装（wardrobe）与家园（home）共用本服务的购买逻辑，避免重复实现扣费/入库。
 *
 * 重构后本服务**自己不碰数据库**：目录读 `AssetCatalogService`，持有读
 * `InventoryService`，写一律经 `RewardService`。它剩下的职责是「把物品域的业务
 * 规则（是不是家具、够不够钱买、下架了没）翻译成一次记账」。
 */
@Injectable()
export class ItemsService {
  constructor(
    private readonly catalog: AssetCatalogService,
    private readonly inventory: InventoryService,
    private readonly reward: RewardService,
    private readonly economy: EconomyService,
  ) {}

  // ---------------------------------------------------------------- 读

  async listDefsByType(types: ItemType[]): Promise<AssetView[]> {
    return this.catalog.listByItemType(types);
  }

  async getDefByCode(key: string): Promise<AssetView | null> {
    return this.catalog.getByCode(key);
  }

  /** 玩家背包：assetCode -> 件数。 */
  async ownedMap(userId: string): Promise<Map<string, number>> {
    return this.inventory.ownedMap(userId);
  }

  /** 收藏统计：按表现层类型数「拥有多少种」（不是多少件）。 */
  async ownedKindCount(userId: string): Promise<Record<string, number>> {
    return this.inventory.ownedKindCount(userId);
  }

  // ---------------------------------------------------------------- 写

  /**
   * 无偿发放物品（扭蛋发奖、兑换即时到账、后台补偿）。
   *
   * `bizKey` 是**必填**的：幂等必须落在 `asset_txn.biz_id` 的唯一约束上，
   * 而不是只靠 `IdempotencyInterceptor` 的 Redis 24h 窗口——后者过期之后，
   * 重复提交同一 bizId 会真的再发一次。落到分录上还有个附带好处：
   * 「我的皮肤没了」能从流水里查出来。
   *
   * 本方法**不抢锁**，因此持有 `pet:{userId}` 锁的调用方可以直接调它。
   * 这条性质要保持：记账路径一旦开始抢锁，持锁者会抢不到自己已持有的锁而抛 409。
   */
  async grant(
    userId: string,
    assetCode: string,
    qty = 1,
    bizKey?: string,
    reason: LedgerReason = 'compensation',
  ): Promise<{ assetCode: string; qty: number; granted: number }> {
    const def = await this.catalog.getByCode(assetCode);
    if (!def) throw new NotFoundException('物品不存在');
    const n = Math.max(1, Math.trunc(qty));

    await this.reward.grant(userId, [{ assetCode: def.code, count: n }], {
      reason,
      bizKey: bizKey ?? `item:grant:${def.code}:${n}`,
      scope: 'sys',
      refType: 'asset_def',
      refId: def.code,
    });

    return {
      assetCode: def.code,
      qty: await this.inventory.ownedQty(userId, def.code),
      granted: n,
    };
  }

  /**
   * 购买物品：**一张凭证**同时扣费与入库。
   *
   * 扣费与入库必须同事务：拆成两次独立写入的话，中间崩掉就是扣了钱没给东西，
   * 且只能靠调用方小心地不重放入库来补救。合成一张凭证后中间态不存在。
   */
  async buy(
    userId: string,
    assetCode: string,
    bizId: string,
    count = 1,
  ): Promise<BuyResult> {
    const def = await this.catalog.getByCode(assetCode);
    if (!def || !def.enabled) throw new NotFoundException('物品不存在或已下架');
    if (def.price <= 0) throw new BadRequestException('该物品无需购买');
    const n = Math.max(1, Math.trunc(count));

    const result = await this.reward.exchange(
      userId,
      [{ assetCode: def.priceAsset, count: def.price * n }],
      [{ assetCode: def.code, count: n }],
      {
        reason: 'purchase',
        bizKey: `shop:buy:${bizId}`,
        refType: 'asset_def',
        refId: def.code,
      },
    );

    return {
      assetCode: def.code,
      qty: await this.inventory.ownedQty(userId, def.code),
      wallet: await this.economy.getWallet(userId),
      duplicated: result.duplicated,
      serial: result.minted[0]?.serial ?? null,
    };
  }

  /**
   * 扣减背包持有量（消耗品使用等）。
   *
   * 返回扣减后的余量；库存不足**抛 400 而不是返回 null**：不足由
   * `asset_balance` 的条件 UPDATE 拦住并整体回滚事务，本就是异常路径。
   * 用返回值表达失败迟早会遇到调用方漏判（一个没判到的空值等于不限量消耗），
   * 而异常漏判会直接冒到全局过滤器，不会静默放行。
   */
  async consumeOwned(
    userId: string,
    assetCode: string,
    bizKey: string,
    n = 1,
  ): Promise<number> {
    const def = await this.catalog.getByCode(assetCode);
    if (!def) throw new NotFoundException('物品不存在');
    if (def.kind === 'unique') {
      throw new BadRequestException('唯一物品不能按数量消耗');
    }

    await this.reward.charge(userId, [{ assetCode: def.code, count: n }], {
      reason: 'consume',
      bizKey: `item:consume:${bizKey}`,
      refType: 'asset_def',
      refId: def.code,
    });
    return this.inventory.ownedQty(userId, def.code);
  }
}
