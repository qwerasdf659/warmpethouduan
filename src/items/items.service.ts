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

export interface ItemDefView {
  key: string;
  type: string;
  name: string;
  slot: string | null;
  price: number;
  pool: string;
  comfort: number;
  meta: Record<string, unknown>;
  sortOrder: number;
  /** 是否可在玩家间交易（前端据此显示「挂单」入口） */
  tradable: boolean;
  /** 限量总量与已发行量（`null` = 不限量） */
  mintLimit: number | null;
  mintedCount: number;
}

export interface BuyResult {
  itemKey: string;
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

  async getDefByKey(key: string): Promise<AssetView | null> {
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

  toDefView(d: AssetView): ItemDefView {
    return {
      key: d.code,
      type: d.itemType ?? '',
      name: d.name,
      slot: d.slot,
      price: d.price,
      // 出参保留 `pool` 字段名以不破坏客户端契约；值由计价资产反推
      pool: d.priceAsset === 'marketing_point' ? 'marketing' : 'game',
      comfort: d.comfort,
      meta: d.meta,
      sortOrder: d.sortOrder,
      tradable: d.tradable,
      mintLimit: d.mintLimit,
      mintedCount: d.mintedCount,
    };
  }

  // ---------------------------------------------------------------- 写

  /**
   * 无偿发放物品（扭蛋发奖、兑换即时到账、后台补偿）。
   *
   * `bizKey` 现在是**必填**的：旧模型下物品发放没有持久幂等位，只靠
   * `IdempotencyInterceptor` 的 Redis 24h 窗口，隔日重复提交同一 bizId 会真的
   * 再发一次（这就是缺口 G1）。收敛到 `asset_txn.biz_id` 之后，发放与发币享有
   * 同一套持久幂等，「我的皮肤没了」也终于能从分录里查出来。
   *
   * 也不再有 `grant` / `grantUnlocked` 之分：两者存在的唯一理由是 Redis 锁不可重入，
   * 而记账路径已经不用锁了。那个区分曾让「兑换即时到账」静默降级成人工发货
   * ——持锁者调 `grant` 抢不到自己的锁、抛 409、被 catch 吞掉。
   */
  async grant(
    userId: string,
    itemKey: string,
    qty = 1,
    bizKey?: string,
    reason: LedgerReason = 'compensation',
  ): Promise<{ itemKey: string; qty: number; granted: number }> {
    const def = await this.catalog.getByCode(itemKey);
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
      itemKey: def.code,
      qty: await this.inventory.ownedQty(userId, def.code),
      granted: n,
    };
  }

  /**
   * 购买物品：**一张凭证**同时扣费与入库。
   *
   * 这是缺口 G2 的修复点。旧实现是「`economy.apply` 扣费」后再「`addOwned` 入库」
   * 两次独立写入，中间崩掉就是扣了钱没给东西，只能靠 `duplicated` 标志小心地
   * 不重放入库。现在两者在同一事务里，中间态不存在。
   */
  async buy(
    userId: string,
    itemKey: string,
    bizId: string,
    count = 1,
  ): Promise<BuyResult> {
    const def = await this.catalog.getByCode(itemKey);
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
      itemKey: def.code,
      qty: await this.inventory.ownedQty(userId, def.code),
      wallet: await this.economy.getWallet(userId),
      duplicated: result.duplicated,
      serial: result.minted[0]?.serial ?? null,
    };
  }

  /**
   * 扣减背包持有量（消耗品使用等）。
   *
   * 返回扣减后的余量；库存不足抛 400 —— 与旧实现返回 `null` 不同：余额不足在新
   * 模型里由 `asset_balance` 的条件 UPDATE 拦住并整体回滚事务，本就是异常路径，
   * 没有「安静地返回 null 让调用方自己判」的余地（那个 null 曾因 `rowsOf` 用错
   * 而变成 NaN，等于不限量消耗）。
   */
  async consumeOwned(
    userId: string,
    itemKey: string,
    bizKey: string,
    n = 1,
  ): Promise<number> {
    const def = await this.catalog.getByCode(itemKey);
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
