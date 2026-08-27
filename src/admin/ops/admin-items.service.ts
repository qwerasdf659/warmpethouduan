import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AssetDef, AssetMeta } from '../../entities/asset-def.entity';
import { LedgerService } from '../../ledger/ledger.service';
import { GAME_COIN, MARKETING_POINT } from '../../ledger/ledger.types';
import { CreateItemDefDto, UpdateItemDefDto } from './dto/item-def.dto';

/** 后台看到的资产定义视图。 */
export interface AdminAssetView {
  code: string;
  kind: string;
  type: string | null;
  name: string;
  slot: string | null;
  price: number;
  pool: string;
  comfort: number;
  enabled: boolean;
  sortOrder: number;
  tradable: boolean;
  redeemable: boolean;
  gachaOutput: boolean;
  mintLimit: number | null;
  mintedCount: number;
  meta: AssetMeta;
}

/** 表现层类型 → 资产种类。皮肤/配饰有身份（可编号、可交易），家具/消耗品只有数量。 */
const KIND_OF_TYPE: Record<string, AssetDef['kind']> = {
  skin: 'unique',
  accessory: 'unique',
  furniture: 'stackable',
  consumable: 'stackable',
  // Petpet 是收集品（有实例、可编号、可交易），与皮肤/配饰同构
  petpet: 'unique',
};

/**
 * 资产定义（换装/家具/消耗品）后台 CRUD。
 *
 * **刻意不暴露三个合规开关**（`tradable` / `redeemable` / `gachaOutput`）：
 * 它们的取值组合由 DB CHECK 约束把死，放开需要显式迁移 + 在架构文档追加决策记录。
 * 如果后台能改，那两条 CHECK 就只是「拦住手滑」，而不是「拦住临时起意的运营决定」——
 * 而后者才是真正的风险来源。出参里仍然返回它们，供运营查看。
 */
@Injectable()
export class AdminItemsService {
  constructor(
    @InjectRepository(AssetDef)
    private readonly defs: Repository<AssetDef>,
    private readonly ledger: LedgerService,
  ) {}

  async list(type?: string): Promise<{ list: AdminAssetView[] }> {
    const qb = this.defs
      .createQueryBuilder('d')
      .orderBy('d.sort_order', 'ASC')
      .addOrderBy('d.code', 'ASC');
    if (type) {
      qb.where(`d.meta ->> 'itemType' = :type`, { type });
    }
    return { list: (await qb.getMany()).map((d) => this.toView(d)) };
  }

  /**
   * 补发用的精简目录。包含已下架物品：活动限定款下架后客服仍可能要补发。
   * 排除货币：发币走钱包页（有独立的 `wallet:write` 权限）。
   */
  async grantable(): Promise<{
    list: { key: string; name: string; type: string; slot: string | null }[];
  }> {
    const rows = await this.defs
      .createQueryBuilder('d')
      .where(`d.kind <> 'currency'`)
      .orderBy('d.sort_order', 'ASC')
      .addOrderBy('d.code', 'ASC')
      .getMany();
    return {
      list: rows.map((d) => ({
        key: d.code,
        name: d.name,
        type: (d.meta?.itemType as string) ?? '',
        slot: d.meta?.slot ?? null,
      })),
    };
  }

  async create(dto: CreateItemDefDto): Promise<{ item: AdminAssetView }> {
    const exists = await this.defs.findOne({ where: { code: dto.key } });
    if (exists) throw new BadRequestException('物品 key 已存在');

    const kind = KIND_OF_TYPE[dto.type];
    if (!kind) throw new BadRequestException('未知物品类型');

    const item = await this.defs.save(
      this.defs.create({
        code: dto.key,
        kind,
        name: dto.name,
        // 新建的物品默认可交易；扭蛋产出与可兑实物只能由迁移设置，见类注释
        tradable: true,
        redeemable: false,
        gachaOutput: false,
        mintLimit: dto.mintLimit ?? null,
        mintedCount: 0,
        enabled: dto.enabled ?? true,
        sortOrder: dto.sortOrder ?? 0,
        meta: this.buildMeta({}, dto),
      }),
    );
    this.ledger.invalidateDefCache();
    return { item: this.toView(item) };
  }

  async update(
    code: string,
    dto: UpdateItemDefDto,
  ): Promise<{ item: AdminAssetView }> {
    const item = await this.defs.findOne({ where: { code } });
    if (!item) throw new NotFoundException('物品不存在');

    if (dto.mintLimit !== undefined && dto.mintLimit !== null) {
      // 限量只能上调。已经发出去的编号收不回来，下调会让 `ck_asset_mint_limit`
      // 在下一次发行时才炸（那时错误信息与真正的原因已相隔很远），
      // 更糟的是玩家手上「第 120/100 件」这种自相矛盾的编号无法解释。
      if (dto.mintLimit < item.mintedCount) {
        throw new BadRequestException(
          `限量不能低于已发行数量（已发行 ${item.mintedCount} 件）`,
        );
      }
    }

    item.name = dto.name ?? item.name;
    item.enabled = dto.enabled ?? item.enabled;
    item.sortOrder = dto.sortOrder ?? item.sortOrder;
    if (dto.mintLimit !== undefined) item.mintLimit = dto.mintLimit;
    item.meta = this.buildMeta(item.meta ?? {}, dto);

    const saved = await this.defs.save(item);
    this.ledger.invalidateDefCache();
    return { item: this.toView(saved) };
  }

  /**
   * 删除资产定义。
   *
   * 有流水、有余额或有实例的资产**不允许删**：`asset_entry` / `asset_balance` /
   * `item_instance` 都外键引用 `asset_def.code`，删掉会让历史流水指向不存在的资产，
   * 对账直接失去意义。要下架请用 `enabled = false`。
   */
  async remove(code: string): Promise<{ ok: true }> {
    const item = await this.defs.findOne({ where: { code } });
    if (!item) throw new NotFoundException('物品不存在');
    try {
      await this.defs.delete({ code });
    } catch {
      throw new BadRequestException(
        '该资产已有流水或持有记录，不能删除；请改为下架（enabled = false）',
      );
    }
    this.ledger.invalidateDefCache();
    return { ok: true };
  }

  // ---------------------------------------------------------------- 内部

  private buildMeta(
    base: AssetMeta,
    dto: CreateItemDefDto | UpdateItemDefDto,
  ): AssetMeta {
    const meta: AssetMeta = { ...base, ...(dto.meta ?? {}) };
    if ('type' in dto && dto.type) meta.itemType = dto.type;
    if (dto.slot !== undefined) meta.slot = dto.slot ?? null;
    if (dto.price !== undefined) meta.price = dto.price;
    if (dto.pool !== undefined) {
      meta.priceAsset = dto.pool === 'marketing' ? MARKETING_POINT : GAME_COIN;
    }
    if (dto.comfort !== undefined) meta.comfort = dto.comfort;
    if (dto.gridW !== undefined) meta.gridW = dto.gridW;
    if (dto.gridH !== undefined) meta.gridH = dto.gridH;
    meta.priceAsset ??= GAME_COIN;
    return meta;
  }

  private toView(d: AssetDef): AdminAssetView {
    const meta = d.meta ?? {};
    return {
      code: d.code,
      kind: d.kind,
      type: (meta.itemType as string) ?? null,
      name: d.name,
      slot: meta.slot ?? null,
      price: Number(meta.price ?? 0),
      pool: meta.priceAsset === MARKETING_POINT ? 'marketing' : 'game',
      comfort: Number(meta.comfort ?? 0),
      enabled: d.enabled,
      sortOrder: d.sortOrder,
      tradable: d.tradable,
      redeemable: d.redeemable,
      gachaOutput: d.gachaOutput,
      mintLimit: d.mintLimit,
      mintedCount: d.mintedCount,
      meta,
    };
  }
}
