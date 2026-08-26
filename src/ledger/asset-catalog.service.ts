import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LockService } from '../common/lock/lock.service';
import { AssetDef, AssetKind, AssetMeta } from '../entities/asset-def.entity';
import { AccountService } from './account.service';
import { LedgerService } from './ledger.service';
import { SEED_ASSETS } from './asset-seed';
import { GAME_COIN } from './ledger.types';

/** 表现层分类。账本层不解释它，只有商店/家园/图鉴读。 */
export type ItemType = 'skin' | 'accessory' | 'furniture' | 'consumable';

/**
 * 资产的业务视图：把 `meta` 里的 jsonb 摊平成带类型的字段。
 *
 * 存在的意义是让商店、家园、换装、图鉴这些消费方**永远不直接碰 jsonb**——
 * 否则每个读它的地方都要自己处理 `meta.price` 可能是 undefined 的情形，
 * 而漏一处就是「免费买到 1600 币的皇冠」。
 */
export interface AssetView {
  code: string;
  kind: AssetKind;
  itemType: ItemType | null;
  name: string;
  slot: string | null;
  price: number;
  priceAsset: string;
  comfort: number;
  gridW: number;
  gridH: number;
  tradable: boolean;
  /**
   * 可兑实物。消费方需要它是因为「把资产换成 redeemable 资产」本身就是一条
   * 变现通路 —— 例如系统回收若以营销积分付款，就等于把道具换成了可兑实物的积分。
   */
  redeemable: boolean;
  mintLimit: number | null;
  mintedCount: number;
  enabled: boolean;
  sortOrder: number;
  meta: AssetMeta;
}

/**
 * 资产目录：`asset_def` 的播种与只读访问（替代旧 `ItemsService` 的定义表部分）。
 *
 * 启动时顺带确保两个系统账户（`FEE`/`ESCROW`）存在——市场功能依赖它们，
 * 而它们的创建没有任何自然触发点。
 */
@Injectable()
export class AssetCatalogService implements OnApplicationBootstrap {
  private readonly logger = new Logger('AssetCatalog');

  constructor(
    @InjectRepository(AssetDef)
    private readonly defs: Repository<AssetDef>,
    private readonly accounts: AccountService,
    private readonly ledger: LedgerService,
    private readonly lock: LockService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.lock.withLock(
        'asset:bootstrap',
        async () => {
          await this.accounts.ensureSystemAccounts();
          await this.seed();
        },
        { ttlMs: 30_000, retries: 3, retryDelayMs: 500 },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`资产播种跳过/失败（已忽略）: ${msg}`);
    }
  }

  /** 幂等播种：只补新 code，不改已存在行（理由见 `asset-seed.ts` 注释）。 */
  private async seed(): Promise<void> {
    const existing = await this.defs.find({ select: { code: true } });
    const known = new Set(existing.map((d) => d.code));
    const toInsert = SEED_ASSETS.filter((s) => !known.has(s.code)).map((s) =>
      this.defs.create({
        code: s.code,
        kind: s.kind,
        name: s.name,
        tradable: s.tradable,
        redeemable: s.redeemable ?? false,
        gachaOutput: s.gachaOutput ?? false,
        tradeCooldownHours: s.tradeCooldownHours ?? 72,
        expireDays: s.expireDays ?? null,
        mintLimit: s.mintLimit ?? null,
        mintedCount: 0,
        enabled: true,
        sortOrder: s.sortOrder,
        meta: s.meta ?? {},
      }),
    );
    if (toInsert.length > 0) {
      await this.defs.save(toInsert);
      this.logger.log(`播种资产定义 +${toInsert.length}`);
    }
    this.ledger.invalidateDefCache();
  }

  // ---------------------------------------------------------------- 读

  /** 按表现层类型取目录（仅上架项，按 sortOrder 升序）。 */
  async listByItemType(types: ItemType[]): Promise<AssetView[]> {
    const rows = await this.defs
      .createQueryBuilder('d')
      .where(`d.meta ->> 'itemType' IN (:...types)`, { types })
      .andWhere('d.enabled = true')
      .orderBy('d.sort_order', 'ASC')
      .addOrderBy('d.code', 'ASC')
      .getMany();
    return rows.map((r) => this.toView(r));
  }

  async getByCode(code: string): Promise<AssetView | null> {
    const row = await this.defs.findOne({ where: { code } });
    return row ? this.toView(row) : null;
  }

  async getManyByCode(codes: string[]): Promise<Map<string, AssetView>> {
    if (codes.length === 0) return new Map();
    const rows = await this.defs.find({ where: { code: In(codes) } });
    return new Map(rows.map((r) => [r.code, this.toView(r)]));
  }

  toView(d: AssetDef): AssetView {
    const meta = d.meta ?? {};
    return {
      code: d.code,
      kind: d.kind,
      itemType: meta.itemType ?? null,
      name: d.name,
      slot: meta.slot ?? null,
      // 缺价按 0 处理会让付费物品变免费，所以宁可当作「不可售」的极大值？
      // 不——0 的语义在本项目里就是「免费/不可售」，购买路径会显式拒绝 price<=0，
      // 因此缺价物品无法被买走，是安全的失败方向
      price: Number(meta.price ?? 0),
      priceAsset: String(meta.priceAsset ?? GAME_COIN),
      comfort: Number(meta.comfort ?? 0),
      gridW: Math.max(1, Number(meta.gridW ?? 1)),
      gridH: Math.max(1, Number(meta.gridH ?? 1)),
      tradable: d.tradable,
      redeemable: d.redeemable,
      mintLimit: d.mintLimit,
      mintedCount: d.mintedCount,
      enabled: d.enabled,
      sortOrder: d.sortOrder,
      meta,
    };
  }
}
