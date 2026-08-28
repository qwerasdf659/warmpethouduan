import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomInt } from 'node:crypto';
import { PromoCode } from '../../entities/promo-code.entity';
import { PromoRedemption } from '../../entities/promo-redemption.entity';
import { generateCode, normalizeCode } from '../../promo/promo.config';
import {
  CreatePromoBatchDto,
  QueryPromoCodeDto,
  QueryPromoRedemptionDto,
} from './dto/promo-admin.dto';

/** 生码长度。10 位 × 30 字符集 ≈ 5.9e14 组合，配合每日失败上限足以防爆破。 */
const CODE_LENGTH = 10;

/** 单码重试次数：撞已存在的码时重生成，连续撞这么多次说明字符空间有问题。 */
const MAX_COLLISION_RETRY = 5;

export interface PromoBatchSummary {
  batch: string;
  assetCode: string;
  codes: number;
  totalUses: number;
  usedUses: number;
  redemptions: number;
  enabledCodes: number;
  createdAt: string;
}

/**
 * 后台兑换码管理：批量生码、查码、停用、核销记录。
 *
 * 生码是**一次性写入、明文返回**：码必须在创建响应里交给运营去印物料，
 * 之后列表接口也照常返回明文——它不是密码，运营需要能查、能核对、能补发。
 */
@Injectable()
export class AdminPromoService {
  private readonly logger = new Logger('AdminPromo');

  constructor(
    @InjectRepository(PromoCode)
    private readonly codes: Repository<PromoCode>,
    @InjectRepository(PromoRedemption)
    private readonly redemptions: Repository<PromoRedemption>,
  ) {}

  /**
   * 批量生码。返回全部明文，供运营导出。
   *
   * 逐个 `INSERT ... ON CONFLICT DO NOTHING` 而不是一次性批量插：
   * 撞码时需要知道**哪一个**撞了并单独重生成，批量插做不到这件事。
   * count 上界 5000 已由 DTO 限制，这个量级的逐行插入是可接受的。
   */
  async createBatch(dto: CreatePromoBatchDto): Promise<{
    batch: string;
    created: number;
    codes: string[];
  }> {
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException('过期时间格式不正确');
    }
    const maxUses = dto.maxUses ?? 1;
    const created: string[] = [];

    for (let i = 0; i < dto.count; i += 1) {
      const code = await this.insertUnique({
        batch: dto.batch,
        assetCode: dto.assetCode,
        amount: dto.amount,
        maxUses,
        expiresAt,
        remark: dto.remark ?? null,
      });
      if (code) created.push(code);
    }

    if (created.length < dto.count) {
      this.logger.warn(
        `批次 ${dto.batch} 实际生成 ${created.length}/${dto.count}（撞码重试耗尽）`,
      );
    }
    return { batch: dto.batch, created: created.length, codes: created };
  }

  private async insertUnique(base: {
    batch: string;
    assetCode: string;
    amount: number;
    maxUses: number;
    expiresAt: Date | null;
    remark: string | null;
  }): Promise<string | null> {
    for (let attempt = 0; attempt < MAX_COLLISION_RETRY; attempt += 1) {
      const code = generateCode(CODE_LENGTH, (max) => randomInt(max));
      const res = await this.codes.query<unknown[]>(
        `INSERT INTO promo_code (code, batch, asset_code, amount, max_uses, used_count, expires_at, enabled, remark)
         VALUES ($1, $2, $3, $4, $5, 0, $6, true, $7)
         ON CONFLICT (code) DO NOTHING
         RETURNING code`,
        [
          code,
          base.batch,
          base.assetCode,
          base.amount,
          base.maxUses,
          base.expiresAt,
          base.remark,
        ],
      );
      if (res.length > 0) return code;
    }
    return null;
  }

  /** 码列表分页。 */
  async listCodes(q: QueryPromoCodeDto): Promise<{
    list: PromoCode[];
    total: number;
  }> {
    const qb = this.codes.createQueryBuilder('c').orderBy('c.id', 'DESC');
    if (q.batch) qb.andWhere('c.batch = :batch', { batch: q.batch });
    if (q.code) {
      qb.andWhere('c.code = :code', { code: normalizeCode(q.code) });
    }
    if (q.enabled !== undefined) {
      qb.andWhere('c.enabled = :enabled', { enabled: q.enabled });
    }
    const [list, total] = await qb
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize)
      .getManyAndCount();
    return { list, total };
  }

  /**
   * 批次汇总。用于后台「发了多少、核销了多少」这一屏。
   *
   * `used_uses` 取 `sum(used_count)` 而 `redemptions` 取核销行数：
   * 两者正常应当相等，不等就说明有「占用了次数但入账失败」的记录，
   * 是需要人工看一眼的信号，所以分开列而不是只留一个。
   */
  async listBatches(): Promise<{ list: PromoBatchSummary[] }> {
    const rows = await this.codes
      .createQueryBuilder('c')
      .select('c.batch', 'batch')
      .addSelect('MIN(c.asset_code)', 'assetCode')
      .addSelect('COUNT(*)', 'codes')
      .addSelect('SUM(c.max_uses)', 'total_uses')
      .addSelect('SUM(c.used_count)', 'used_uses')
      .addSelect('COUNT(*) FILTER (WHERE c.enabled)', 'enabled_codes')
      .addSelect('MIN(c.created_at)', 'created_at')
      .groupBy('c.batch')
      .orderBy('MIN(c.created_at)', 'DESC')
      .getRawMany<{
        batch: string;
        assetCode: string;
        codes: string;
        total_uses: string;
        used_uses: string;
        enabled_codes: string;
        created_at: Date;
      }>();

    const redeemed = await this.redemptions
      .createQueryBuilder('r')
      .innerJoin(PromoCode, 'c', 'c.id = r.code_id')
      .select('c.batch', 'batch')
      .addSelect('COUNT(*)', 'n')
      .groupBy('c.batch')
      .getRawMany<{ batch: string; n: string }>();
    const redeemedMap = new Map(redeemed.map((r) => [r.batch, Number(r.n)]));

    return {
      list: rows.map((r) => ({
        batch: r.batch,
        assetCode: r.assetCode,
        codes: Number(r.codes),
        totalUses: Number(r.total_uses),
        usedUses: Number(r.used_uses),
        redemptions: redeemedMap.get(r.batch) ?? 0,
        enabledCodes: Number(r.enabled_codes),
        createdAt: r.created_at.toISOString(),
      })),
    };
  }

  /** 停用/启用单个码。 */
  async toggleCode(
    id: string,
    enabled: boolean,
  ): Promise<{ id: string; enabled: boolean }> {
    const res = await this.codes.update({ id }, { enabled });
    if (!res.affected) throw new BadRequestException('兑换码不存在');
    return { id, enabled };
  }

  /**
   * 停用/启用整批。
   *
   * 作废整批只改 `enabled`，**不删码行**：已核销的记录靠 `code_id` 指向它，
   * 删掉就查不到「这个人当时兑的是哪一批」了。
   */
  async toggleBatch(
    batch: string,
    enabled: boolean,
  ): Promise<{ batch: string; enabled: boolean; affected: number }> {
    const res = await this.codes.update({ batch }, { enabled });
    if (!res.affected) throw new BadRequestException('批次不存在');
    return { batch, enabled, affected: res.affected };
  }

  /** 核销记录分页（可按玩家 / 批次筛）。 */
  async listRedemptions(q: QueryPromoRedemptionDto): Promise<{
    list: Record<string, unknown>[];
    total: number;
  }> {
    const qb = this.redemptions
      .createQueryBuilder('r')
      .innerJoin(PromoCode, 'c', 'c.id = r.code_id')
      .select([
        'r.id AS id',
        'r.user_id AS "userId"',
        'r.code AS code',
        'r.asset_code AS "assetCode"',
        'r.amount AS amount',
        'r.created_at AS "createdAt"',
        'c.batch AS batch',
      ])
      .orderBy('r.id', 'DESC');
    if (q.userId) qb.andWhere('r.user_id = :userId', { userId: q.userId });
    if (q.batch) qb.andWhere('c.batch = :batch', { batch: q.batch });

    const countQb = qb.clone();
    const total = await countQb.getCount();
    const list = await qb
      .offset((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .getRawMany<Record<string, unknown>>();
    return { list, total };
  }
}
