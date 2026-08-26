import { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { REDIS_CLIENT } from '../../src/redis/redis.module';
import { hashPassword } from '../../src/admin/utils/password.util';
import { GameConfigService } from '../../src/config/game-config.service';
import { InventoryService } from '../../src/ledger/inventory.service';
import { LedgerService } from '../../src/ledger/ledger.service';
import { RewardService } from '../../src/ledger/reward.service';
import { GAME_COIN, MARKETING_POINT } from '../../src/ledger/ledger.types';

/**
 * 连真库的 e2e 夹具。
 *
 * 为什么直接连开发库而不另开测试库：本项目只有一个 Sealos 托管实例，
 * 另开库会引入「迁移要跑两遍」的维护成本。代价是**必须严格自清**——
 * 所有测试数据都挂在 `e2e_` 前缀的临时用户下，`teardown()` 按 userId 删干净，
 * 且**绝不改动 `game_config` 等全局表**（配置只读，需要不同数值的用例请自己传参覆盖）。
 */
export class E2eApp {
  private readonly userIds: string[] = [];
  private readonly adminIds: string[] = [];
  private readonly adminRoleCodes: string[] = [];
  /** `fundWallet` 的幂等键序号，见该方法注释 */
  private fundSeq = 0;

  private constructor(
    readonly app: INestApplication,
    readonly db: DataSource,
    readonly redis: Redis,
    private readonly jwt: JwtService,
  ) {}

  static async boot(): Promise<E2eApp> {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const app = moduleRef.createNestApplication();
    // 与 main.ts 保持一致，否则 e2e 测到的校验/错误格式与线上不同
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    return new E2eApp(
      app,
      app.get(DataSource),
      app.get<Redis>(REDIS_CLIENT),
      app.get(JwtService),
    );
  }

  /** supertest 的目标：Nest 底层的 http.Server。 */
  get server(): Server {
    return this.app.getHttpServer() as Server;
  }

  /**
   * 建一个临时玩家并签发可用的玩家令牌。
   * 不走微信登录，因此不依赖 `WECHAT_MOCK_LOGIN` 开关（该开关是联调用的，e2e 不该依赖它）。
   */
  async createPlayer(
    opts: { status?: 'active' | 'banned' } = {},
  ): Promise<{ userId: string; openid: string; token: string }> {
    const openid = `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const rows = await this.db.query<{ id: string }[]>(
      `INSERT INTO "user" (openid, status) VALUES ($1, $2) RETURNING id`,
      [openid, opts.status ?? 'active'],
    );
    const userId = rows[0].id;
    this.userIds.push(userId);
    const token = await this.jwt.signAsync({ sub: userId, openid });
    return { userId, openid, token };
  }

  /**
   * 建一个临时后台账号，并按 permissions 现配一个专属角色。
   *
   * 不复用 super_admin：那是播种出来的系统角色，e2e 往里塞人再删会碰到生产数据；
   * 每个用例自带角色也才能验「权限点不够时被 403 拦下」这类分支。
   * 不返回令牌——后台 e2e 的目的之一就是验登录本身，令牌必须真的登一次拿到。
   */
  async createAdmin(opts: {
    permissions?: string[];
    password?: string;
    status?: 'active' | 'disabled';
  }): Promise<{ adminId: string; username: string; password: string }> {
    const tag = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const username = `e2e_admin_${tag}`;
    const password = opts.password ?? `Pw_${tag}_!aZ9`;
    const roleCode = `e2e_role_${tag}`;

    const admins = await this.db.query<{ id: string }[]>(
      `INSERT INTO admin_user (username, password_hash, display_name, status)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [
        username,
        await hashPassword(password),
        'e2e 测试账号',
        opts.status ?? 'active',
      ],
    );
    const adminId = admins[0].id;
    this.adminIds.push(adminId);

    const roles = await this.db.query<{ id: string }[]>(
      `INSERT INTO admin_role (code, name, description, is_system)
       VALUES ($1, $2, $3, false) RETURNING id`,
      [roleCode, 'e2e 测试角色', '由 e2e 创建，teardown 会删'],
    );
    const roleId = roles[0].id;
    this.adminRoleCodes.push(roleCode);

    await this.db.query(
      `INSERT INTO admin_user_role (admin_user_id, role_id) VALUES ($1, $2)`,
      [adminId, roleId],
    );
    for (const code of opts.permissions ?? []) {
      await this.db.query(
        `INSERT INTO admin_role_permission (role_id, permission_id)
         SELECT $1, id FROM admin_permission WHERE code = $2`,
        [roleId, code],
      );
    }
    return { adminId, username, password };
  }

  /**
   * 清掉限流留下的计数。
   *
   * 两套键都要清：login:fail:* 是 LoginThrottleService 的账号/IP 失败计数，
   * `{...}` 开头的是 @nestjs/throttler 的 Redis 存储（键名带花括号做 hash tag）。
   * 不清的话，一个跑满配额的用例会把 60 秒内的后续用例连坐成 429，
   * 表现为「单独跑能过、连着跑就挂」。
   */
  async resetThrottle(): Promise<void> {
    for (const pattern of ['login:fail:*', '{*}:hits', '{*}:blocked']) {
      const keys = await this.redis.keys(pattern);
      if (keys.length) await this.redis.del(...keys);
    }
  }

  /**
   * 给玩家发放起始余额，用于准备「有钱」的初始状态。
   *
   * 走真实记账入口（`RewardService.grant`）而不是直接压 `asset_balance`：
   * 新模型下余额是 `asset_lot` 的聚合缓存，直接改余额会让批次、分录、余额三层
   * 立刻不一致 —— 而对账的不变量 2/3/9 正是校验这三层一致，于是 e2e 造的数据
   * 会把对账用例自己弄挂。
   */
  async fundWallet(
    userId: string,
    pools: { game?: number; marketing?: number },
  ): Promise<void> {
    const rewards = [
      { assetCode: GAME_COIN, count: pools.game ?? 0 },
      { assetCode: MARKETING_POINT, count: pools.marketing ?? 0 },
    ].filter((r) => r.count > 0);
    if (rewards.length === 0) return;

    await this.app.get(RewardService).grant(userId, rewards, {
      reason: 'compensation',
      // 每次调用一个新键：同一用例里可能连续加两次钱，共用键会命中幂等回放
      bizKey: `e2e:fund:${userId}:${this.fundSeq++}`,
      scope: 'sys',
    });
  }

  async walletOf(
    userId: string,
  ): Promise<{ gameCoin: number; marketingPoint: number }> {
    const balances = await this.app.get(LedgerService).balances(userId);
    return {
      gameCoin: balances[GAME_COIN]?.available ?? 0,
      marketingPoint: balances[MARKETING_POINT]?.available ?? 0,
    };
  }

  /** 玩家持有的某个资产件数（唯一物品按实例数，可堆叠按可用余额）。 */
  async ownedQty(userId: string, assetCode: string): Promise<number> {
    return this.app.get(InventoryService).ownedQty(userId, assetCode);
  }

  /** 玩家持有的唯一物品实例。 */
  async instancesOf(
    userId: string,
    assetCode?: string,
  ): Promise<{ instanceId: string; serial: number | null; state: string }[]> {
    return this.app.get(InventoryService).listInstances(userId, assetCode);
  }

  /**
   * 临时覆盖若干配置项，跑完自动还原。
   *
   * 交易市场的分档开关默认全关（代码就位不等于可以开门做生意），所以市场用例
   * 必须先打开它们。这是本夹具唯一允许改 `game_config` 的口子，且**保证还原**：
   * 原本有值的改回原值，原本没有的删掉 —— 否则一次跑挂的 e2e 会把开发库的
   * 市场开关永久留在打开状态。
   */
  async withConfig<T>(
    overrides: Record<string, unknown>,
    fn: () => Promise<T>,
  ): Promise<T> {
    const keys = Object.keys(overrides);
    const before = new Map<string, unknown>();
    for (const key of keys) {
      const rows = await this.db.query<{ value: unknown }[]>(
        `SELECT value FROM game_config WHERE key = $1`,
        [key],
      );
      before.set(key, rows.length ? rows[0].value : undefined);
      await this.db.query(
        `INSERT INTO game_config (key, description, value) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = $3`,
        [key, 'e2e 临时覆盖', JSON.stringify(overrides[key])],
      );
    }
    this.app.get(GameConfigService).invalidate();

    try {
      return await fn();
    } finally {
      for (const key of keys) {
        const original = before.get(key);
        if (original === undefined) {
          await this.db.query(`DELETE FROM game_config WHERE key = $1`, [key]);
        } else {
          await this.db.query(
            `UPDATE game_config SET value = $2 WHERE key = $1`,
            [key, JSON.stringify(original)],
          );
        }
      }
      this.app.get(GameConfigService).invalidate();
    }
  }

  /** 把玩家的注册时间往前拨，用于绕过 R1 新号交易冷却。 */
  async backdateRegistration(userId: string, days: number): Promise<void> {
    await this.db.query(
      `UPDATE "user" SET created_at = now() - ($2 || ' days')::interval WHERE id = $1`,
      [userId, String(days)],
    );
  }

  /**
   * 把离线收益的计时基准往前拨，用于构造「离线了 N 小时」。
   * 注意基准在 `"user".offline_base_at` 而不是宠物表——离线时长完全由服务端时间推导，
   * 接口不接受客户端申报的时长，所以只能这样造数据。
   */
  async backdateOfflineBase(userId: string, hours: number): Promise<void> {
    await this.db.query(
      `UPDATE "user" SET offline_base_at = now() - ($2 || ' hours')::interval WHERE id = $1`,
      [userId, String(hours)],
    );
  }

  /**
   * 直接改宠物心情。
   * 心情参与赛跑配速，而接口不接受客户端上报数值，只能压库造。
   */
  async setPetMood(userId: string, mood: number): Promise<void> {
    // 同时把结算基准拨到当前，否则读取时的惰性衰减会立刻把设的值算掉
    await this.db.query(
      `UPDATE pet SET mood = $2, last_seen_at = now() WHERE user_id = $1`,
      [userId, mood],
    );
  }

  /** 删掉本次跑出来的所有数据：先删子表，再删 user，最后清 Redis 上的用户级键。 */
  async teardown(): Promise<void> {
    for (const userId of this.userIds) {
      // 顺序即外键顺序：这些表都直接引用 user，故只需保证 user 最后删。
      // 新增引用 user 的表必须登记到这里，否则删 user 会被外键拦住，
      // 整个 e2e 会从「跑完自清」退化成「往开发库里堆垃圾」。
      for (const table of [
        'promo_redemption',
        'gacha_draw',
        'gacha_state',
        'redeem_order',
        'user_address',
        'dex_claim',
        'home_layout',
        'pet_equip',
        'race_record',
        'daily',
        'pet',
      ]) {
        await this.db.query(`DELETE FROM ${table} WHERE user_id = $1`, [
          userId,
        ]);
      }
      await this.cleanupLedger(userId);
      await this.db.query(`DELETE FROM "user" WHERE id = $1`, [userId]);

      const keys = await this.redis.keys(`*:${userId}:*`);
      const more = await this.redis.keys(`*:${userId}`);
      const all = [...keys, ...more];
      if (all.length) await this.redis.del(...all);
    }
    this.userIds.length = 0;
    await this.cleanupSystemAccounts();
    await this.cleanupOrphanTxns();

    // 后台侧：审计日志不带外键但会一直堆着，一并按 admin_user_id 删掉
    for (const adminId of this.adminIds) {
      await this.db.query(
        `DELETE FROM admin_audit_log WHERE admin_user_id = $1`,
        [adminId],
      );
      await this.db.query(
        `DELETE FROM admin_user_role WHERE admin_user_id = $1`,
        [adminId],
      );
      await this.db.query(`DELETE FROM admin_user WHERE id = $1`, [adminId]);
    }
    for (const code of this.adminRoleCodes) {
      await this.db.query(
        `DELETE FROM admin_role_permission WHERE role_id IN
           (SELECT id FROM admin_role WHERE code = $1)`,
        [code],
      );
      await this.db.query(`DELETE FROM admin_role WHERE code = $1`, [code]);
    }
    this.adminIds.length = 0;
    this.adminRoleCodes.length = 0;
    await this.resetThrottle();

    await this.app.close();
  }

  /**
   * 清掉某玩家的账本数据。
   *
   * 账本表**不直接引用 user**，而是经 `account` 中转，所以不能像其它表那样按
   * `user_id` 一把删。顺序是外键的拓扑序：分录 → 实例 → 批次/余额 → 账户。
   */
  private async cleanupLedger(userId: string): Promise<void> {
    const rows = await this.db.query<{ id: string }[]>(
      `SELECT id FROM account WHERE user_id = $1`,
      [userId],
    );
    const accountId = rows[0]?.id;
    if (!accountId) return;

    await this.db.query(
      `DELETE FROM market_bid WHERE bidder_account_id = $1
         OR listing_id IN (SELECT id FROM market_listing WHERE seller_account_id = $1)`,
      [accountId],
    );
    await this.db.query(
      `DELETE FROM market_listing WHERE seller_account_id = $1`,
      [accountId],
    );
    await this.db.query(
      `DELETE FROM item_instance_entry WHERE account_id = $1
         OR instance_id IN (SELECT id FROM item_instance WHERE owner_account_id = $1)`,
      [accountId],
    );
    await this.db.query(
      `DELETE FROM item_instance WHERE owner_account_id = $1`,
      [accountId],
    );
    for (const table of [
      'asset_entry',
      'asset_lot',
      'asset_balance',
      'trade_risk_daily',
    ]) {
      await this.db.query(`DELETE FROM ${table} WHERE account_id = $1`, [
        accountId,
      ]);
    }
    await this.db.query(`DELETE FROM account WHERE id = $1`, [accountId]);
  }

  /**
   * 清掉 `FEE` / `ESCROW` 两个系统账户上的 e2e 残留。
   *
   * 这两个账户不属于任何玩家，因此不会被 `cleanupLedger` 扫到，但交易用例会往里
   * 留东西：成交手续费进 `FEE`，而「挂单后没撤单」的用例会把实例留在 `ESCROW`
   * 名下。不清的话每跑一次 e2e 就多积一批，`FEE` 的余额和 `ESCROW` 的持仓
   * 会单调增长，最终让「全服总币量」这类看板统计失真。
   *
   * 系统账户本身**不删**：它们由启动播种保证存在，删了下次启动还要重建，
   * 而 account id 变化会让缓存过的 id 失效。
   */
  private async cleanupSystemAccounts(): Promise<void> {
    const rows = await this.db.query<{ id: string }[]>(
      `SELECT id FROM account WHERE system_code IS NOT NULL`,
    );
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return;

    // 托管中的实例：挂单行已随卖家一起删掉，这些实例已无人认领
    await this.db.query(
      `DELETE FROM item_instance_entry
        WHERE account_id = ANY($1::bigint[])
           OR instance_id IN (
                SELECT id FROM item_instance WHERE owner_account_id = ANY($1::bigint[]))`,
      [ids],
    );
    await this.db.query(
      `DELETE FROM item_instance WHERE owner_account_id = ANY($1::bigint[])`,
      [ids],
    );
    for (const table of [
      'asset_entry',
      'asset_lot',
      'asset_balance',
      'trade_risk_daily',
    ]) {
      await this.db.query(
        `DELETE FROM ${table} WHERE account_id = ANY($1::bigint[])`,
        [ids],
      );
    }
  }

  /**
   * 删掉不再被任何分录/实例/挂单引用的凭证头。
   *
   * 单独一步而不是随玩家删：一张 `transfer` 凭证同时属于买卖双方，
   * 按玩家删会在只清掉其中一方时就把凭证删掉，另一方的分录随即变成孤儿。
   * 等所有玩家都清完再扫一遍孤儿凭证，是唯一安全的顺序。
   */
  private async cleanupOrphanTxns(): Promise<void> {
    /*
     * 不按 biz_id 前缀筛。凭证头的 bizId 形如 `u{userId}:shop:buy:{uuid}`，
     * 里面没有任何 e2e 标记可认；而「没有任何分录、实例、挂单、出价引用它，
     * 也没有冲正指向它」的凭证头本身就不携带信息 —— 它只可能是刚才删分录时
     * 留下的残骸。因此无条件删是安全的。
     *
     * reversal_of 是自引用，被引用的原凭证要等冲正凭证先删掉，故循环几轮。
     */
    for (let round = 0; round < 3; round += 1) {
      const deleted = await this.db.query<{ id: string }[]>(
        `DELETE FROM asset_txn t
          WHERE NOT EXISTS (SELECT 1 FROM asset_entry e WHERE e.txn_id = t.id)
            AND NOT EXISTS (SELECT 1 FROM item_instance i WHERE i.minted_txn_id = t.id)
            AND NOT EXISTS (SELECT 1 FROM item_instance_entry ie WHERE ie.txn_id = t.id)
            AND NOT EXISTS (SELECT 1 FROM market_listing l
                             WHERE l.created_txn_id = t.id OR l.settled_txn_id = t.id)
            AND NOT EXISTS (SELECT 1 FROM market_bid b WHERE b.freeze_txn_id = t.id)
            AND NOT EXISTS (SELECT 1 FROM asset_txn r WHERE r.reversal_of = t.id)
          RETURNING t.id`,
      );
      if (deleted.length === 0) break;
    }
  }
}
