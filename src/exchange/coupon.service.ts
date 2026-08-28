import { randomBytes } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { ClockService } from '../common/clock/clock.service';
import { LockService } from '../common/lock/lock.service';
import { AssetCatalogService } from '../ledger/asset-catalog.service';
import { InventoryService } from '../ledger/inventory.service';
import { RewardService } from '../ledger/reward.service';
import { REDIS_CLIENT } from '../redis/redis.module';

/** 核销码有效期。够玩家在收银台出示，又短到丢失截图也无所谓。 */
const CODE_TTL_SEC = 15 * 60;

export interface CouponHolding {
  assetCode: string;
  name: string;
  qty: number;
  /** 满减门槛（分） */
  threshold: number;
  /** 减免金额（分） */
  deduct: number;
}

export interface CouponCodeIssued {
  code: string;
  assetCode: string;
  name: string;
  threshold: number;
  deduct: number;
  expiresInSec: number;
}

export interface CouponVerifyResult {
  ok: true;
  userId: string;
  assetCode: string;
  threshold: number;
  deduct: number;
}

/**
 * 满减券的持有查询、核销码签发与门店核销。
 *
 * 券本身就是一种 `redeemable` 的可堆叠资产，所以持有量、有效期、过期销毁
 * 全部由账本现成的机制承担——这里**不维护任何券的库存状态**，
 * 只负责「销毁一张 + 发一个短时效凭据」。
 *
 * 为什么销毁发生在签发核销码的那一刻、而不是门店确认之后：
 * 券已经离开玩家背包，玩家不可能拿同一张券在两家店同时出示。
 * 反过来（先给码、核销时才扣）就必须在 Redis 里锁住那张券，
 * 而 Redis 掉一次就等于凭空多出一张可用券——那是账实不符，比多担一点客诉严重得多。
 * 代价是「出示了但没消费」会浪费一张券，这一点必须在前端文案里讲清楚。
 */
@Injectable()
export class CouponService {
  /** 返回核销载荷 JSON；nil = 码不存在/已过期/已被核销。读与删必须原子，否则同一码可双花。 */
  private static readonly CONSUME_LUA = `
local v = redis.call('GET', KEYS[1])
if not v then return nil end
redis.call('DEL', KEYS[1])
return v
`;

  constructor(
    private readonly catalog: AssetCatalogService,
    private readonly inventory: InventoryService,
    private readonly reward: RewardService,
    private readonly lock: LockService,
    private readonly clock: ClockService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** 我持有的券（按券种聚合，含满减规则）。 */
  async myCoupons(userId: string): Promise<{ coupons: CouponHolding[] }> {
    const owned = await this.inventory.ownedMap(userId);
    if (owned.size === 0) return { coupons: [] };

    const defs = await this.catalog.getManyByCode([...owned.keys()]);
    const coupons: CouponHolding[] = [];
    for (const [code, qty] of owned) {
      const def = defs.get(code);
      if (!def || def.itemType !== 'coupon' || qty <= 0) continue;
      coupons.push({
        assetCode: code,
        name: def.name,
        qty,
        threshold: Number(def.meta.couponThreshold ?? 0),
        deduct: Number(def.meta.couponDeduct ?? 0),
      });
    }
    return { coupons };
  }

  /**
   * 出示核销码：销毁一张券，换一枚 15 分钟有效的一次性码。
   *
   * `bizKey` 用 bizId 派生，落 `asset_txn.biz_id` 唯一约束——弱网重试不会烧掉两张券。
   * 但**重试会拿到同一张码吗？** 不会：账本回放告诉我们没有重复扣，
   * 此时按同一 bizId 复用码键即可，见下面的 replay 分支。
   */
  async issueCode(
    userId: string,
    bizId: string,
    assetCode: string,
  ): Promise<CouponCodeIssued> {
    return this.lock.withLock(`pet:${userId}`, async () => {
      const def = await this.catalog.getByCode(assetCode);
      if (!def || def.itemType !== 'coupon') {
        throw new BadRequestException('该资产不是优惠券');
      }
      if (!def.redeemable) {
        // 后台新建的券是 redeemable=false 的普通道具，核销它等于凭空造一个折扣凭据
        throw new BadRequestException('该券不支持核销');
      }

      // 幂等重放：同一 bizId 已经扣过券，直接把当时那枚码还回去
      const replayKey = this.bizKeyOf(userId, bizId);
      const cached = await this.redis.get(replayKey);
      if (cached) {
        const code = cached;
        const ttl = await this.redis.ttl(this.codeKeyOf(code));
        return {
          code,
          assetCode,
          name: def.name,
          threshold: Number(def.meta.couponThreshold ?? 0),
          deduct: Number(def.meta.couponDeduct ?? 0),
          expiresInSec: Math.max(0, ttl),
        };
      }

      const owned = await this.inventory.ownedQty(userId, assetCode);
      if (owned < 1) throw new BadRequestException('没有可用的该券');

      await this.reward.charge(userId, [{ assetCode, count: 1 }], {
        reason: 'coupon_redeem',
        bizKey: `coupon:${bizId}`,
      });

      const code = this.newCode();
      const payload = JSON.stringify({
        userId,
        assetCode,
        threshold: Number(def.meta.couponThreshold ?? 0),
        deduct: Number(def.meta.couponDeduct ?? 0),
        issuedAt: this.clock.now().toISOString(),
      });
      await this.redis.set(this.codeKeyOf(code), payload, 'EX', CODE_TTL_SEC);
      await this.redis.set(replayKey, code, 'EX', CODE_TTL_SEC);

      return {
        code,
        assetCode,
        name: def.name,
        threshold: Number(def.meta.couponThreshold ?? 0),
        deduct: Number(def.meta.couponDeduct ?? 0),
        expiresInSec: CODE_TTL_SEC,
      };
    });
  }

  /**
   * 门店核销（后台侧）。原子读删，同一码只能成功一次。
   *
   * 不再动账本：券在签发码时就已经销毁了，这里只是把凭据兑掉。
   */
  async verifyCode(code: string): Promise<CouponVerifyResult> {
    const raw = (await this.redis.eval(
      CouponService.CONSUME_LUA,
      1,
      this.codeKeyOf(code),
    )) as string | null;

    if (!raw) throw new BadRequestException('核销码无效或已过期');

    const data = JSON.parse(raw) as {
      userId: string;
      assetCode: string;
      threshold: number;
      deduct: number;
    };
    return {
      ok: true,
      userId: data.userId,
      assetCode: data.assetCode,
      threshold: data.threshold,
      deduct: data.deduct,
    };
  }

  /** 8 位大写字母数字，去掉易混字符（0/O、1/I），方便收银员口播与手输。 */
  private newCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = randomBytes(8);
    let out = '';
    for (let i = 0; i < 8; i += 1) {
      out += alphabet[bytes[i] % alphabet.length];
    }
    return out;
  }

  private codeKeyOf(code: string): string {
    return `coupon:code:${code}`;
  }

  private bizKeyOf(userId: string, bizId: string): string {
    return `coupon:biz:${userId}:${bizId}`;
  }
}
