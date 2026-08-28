import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { ClockService } from '../common/clock/clock.service';
import {
  businessDayKey,
  secondsUntilNextBusinessDay,
} from '../common/time/business-day';
import { GameConfigService } from '../config/game-config.service';
import { EconomyService, WalletView } from '../economy/economy.service';
import { rowsOf } from '../common/db/query-result';
import { PromoCode } from '../entities/promo-code.entity';
import { PromoRedemption } from '../entities/promo-redemption.entity';
import { normalizeCode } from './promo.config';

export interface PromoRedeemResult {
  code: string;
  batch: string;
  assetCode: string;
  amount: number;
  wallet: WalletView;
  /** true = 该码此前已由本人核销过，本次为幂等回放，未二次入账 */
  duplicated: boolean;
}

/**
 * 兑换码核销。**营销积分唯一的玩家侧入账路径**。
 *
 * 核销分两步，顺序刻意如此：
 *  ① 领用（DB）：条件自增 `used_count` + 插入 `promo_redemption`，两者同一事务；
 *  ② 入账（economy）：用服务端派生的稳定 `bizId = promo:{codeId}`。
 *
 * 为什么不合成一个事务：`EconomyService.apply` 自带事务与幂等语义，塞进外层事务
 * 会让「唯一冲突 → 幂等回放」的处理变得不可靠。拆开后仍然安全，因为 ① 是**持久**的
 * 领用凭证、② 由稳定 bizId 保证幂等 —— 若 ② 失败，玩家重提同一个码会命中已有的
 * 领用记录并直接重走 ②，钱不会少发也不会多发。
 */
@Injectable()
export class PromoService {
  private readonly logger = new Logger('Promo');

  constructor(
    @InjectRepository(PromoCode)
    private readonly codes: Repository<PromoCode>,
    @InjectRepository(PromoRedemption)
    private readonly redemptions: Repository<PromoRedemption>,
    private readonly economy: EconomyService,
    private readonly config: GameConfigService,
    private readonly clock: ClockService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** 我的核销记录（分页倒序）。 */
  async myRedemptions(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<{ list: PromoRedemption[]; total: number }> {
    const [list, total] = await this.redemptions.findAndCount({
      where: { userId },
      order: { id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { list, total };
  }

  async redeem(userId: string, rawCode: string): Promise<PromoRedeemResult> {
    const code = normalizeCode(rawCode);
    if (code.length === 0) throw new BadRequestException('兑换码格式不正确');

    const guard = await this.config.get('promo.guard');
    const now = this.clock.now();
    const day = businessDayKey(now);
    const ttlSec = secondsUntilNextBusinessDay(now);

    await this.assertUnderLimit(
      `promo:fail:${userId}:${day}`,
      guard.dailyFailLimit,
      '今日尝试次数过多，请明日再试',
    );

    const row = await this.codes.findOne({ where: { code } });
    if (!row) {
      // 码不存在与码已失效返回同样含糊的提示：区分开就等于给爆破者一个「码是否存在」的探测器。
      // 状态码这里仍有 404 / 400 之分，理论上也是弱探测器，但码空间 30^10 叠加
      // `dailyFailLimit` 的每日失败次数上限，枚举不可行，故按 REST 语义保留 404。
      await this.bumpCounter(`promo:fail:${userId}:${day}`, ttlSec);
      throw new NotFoundException('兑换码无效或已失效');
    }

    // 已核销过 → 直接重走入账（幂等），不消耗失败额度也不再占用次数
    const existing = await this.redemptions.findOne({
      where: { codeId: row.id, userId },
    });
    if (existing) {
      return this.credit(userId, row, existing, true);
    }

    await this.assertUnderLimit(
      `promo:ok:${userId}:${day}`,
      guard.dailySuccessLimit,
      '今日兑换次数已达上限',
    );

    if (
      !row.enabled ||
      (row.expiresAt && row.expiresAt.getTime() <= now.getTime())
    ) {
      await this.bumpCounter(`promo:fail:${userId}:${day}`, ttlSec);
      throw new BadRequestException('兑换码无效或已失效');
    }

    const claimed = await this.claim(row, userId, now);
    if (!claimed) {
      await this.bumpCounter(`promo:fail:${userId}:${day}`, ttlSec);
      throw new BadRequestException('兑换码已被领完');
    }

    await this.bumpCounter(`promo:ok:${userId}:${day}`, ttlSec);
    return this.credit(userId, row, claimed, false);
  }

  // ---------------------------------------------------------------- 内部

  /**
   * 领用：条件自增 + 插入核销行，同一事务。
   *
   * 自增条件把「停用、过期、用尽」三种失效一并塞进 `WHERE`，让判定和占用在**同一条
   * 语句**里完成 —— 先查后改会在并发下超发（两个请求都看到 `used_count < max_uses`）。
   *
   * 返回 null = 没抢到（已用尽或刚被停用）。
   */
  private async claim(
    row: PromoCode,
    userId: string,
    now: Date,
  ): Promise<PromoRedemption | null> {
    return this.codes.manager.transaction(async (mgr) => {
      // 必须经 rowsOf：未命中的 UPDATE 返回 `[[], 0]`（长度为 2），
      // 直接判 `res.length === 0` 恒为假，用尽判断会整个失效
      const res = rowsOf<{ id: string }>(
        await mgr.query(
          `UPDATE promo_code
            SET used_count = used_count + 1, updated_at = now()
          WHERE id = $1
            AND enabled = true
            AND used_count < max_uses
            AND (expires_at IS NULL OR expires_at > $2)
          RETURNING id`,
          [row.id, now],
        ),
      );
      if (res.length === 0) return null;

      try {
        const entity = mgr.create(PromoRedemption, {
          codeId: row.id,
          userId,
          code: row.code,
          assetCode: row.assetCode,
          amount: row.amount,
        });
        return await mgr.save(entity);
      } catch {
        // 同一玩家并发提交同一个码：唯一索引挡下第二次，回滚以退回刚占用的次数
        throw new BadRequestException('兑换码正在处理中，请勿重复提交');
      }
    });
  }

  /** 入账：稳定 bizId 派生自码 id，重复调用由经济域幂等兜住。 */
  private async credit(
    userId: string,
    row: PromoCode,
    redemption: PromoRedemption,
    replay: boolean,
  ): Promise<PromoRedeemResult> {
    const applied = await this.economy.apply({
      userId,
      assetCode: redemption.assetCode,
      delta: redemption.amount,
      bizId: `promo:${row.id}`,
      reason: 'promo',
      refId: row.code,
    });
    return {
      code: row.code,
      batch: row.batch,
      assetCode: redemption.assetCode,
      amount: redemption.amount,
      wallet: applied.wallet,
      duplicated: replay || applied.duplicated,
    };
  }

  private async assertUnderLimit(
    key: string,
    limit: number,
    message: string,
  ): Promise<void> {
    const cur = await this.readCounter(key);
    if (cur >= limit) throw new BadRequestException(message);
  }

  private async readCounter(key: string): Promise<number> {
    try {
      const v = await this.redis.get(key);
      return v ? Number(v) : 0;
    } catch (err) {
      // 频控是加固项，Redis 挂了不该让兑换码整体不可用（软失败不死亡）
      this.logger.warn(`兑换码频控读取失败（按 0 处理）: ${this.msg(err)}`);
      return 0;
    }
  }

  private async bumpCounter(key: string, ttlSec: number): Promise<void> {
    try {
      await this.redis.incr(key);
      await this.redis.expire(key, ttlSec);
    } catch (err) {
      this.logger.warn(`兑换码频控计数失败（已忽略）: ${this.msg(err)}`);
    }
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
