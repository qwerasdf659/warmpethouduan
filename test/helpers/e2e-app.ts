import { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { REDIS_CLIENT } from '../../src/redis/redis.module';

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

  /** 直接给钱包记账（等价于后台发放），用于准备「有钱」的初始状态。 */
  async fundWallet(
    userId: string,
    pools: { game?: number; marketing?: number },
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO wallet (user_id, game_coin, marketing_point) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET game_coin = $2, marketing_point = $3`,
      [userId, pools.game ?? 0, pools.marketing ?? 0],
    );
  }

  async walletOf(
    userId: string,
  ): Promise<{ gameCoin: number; marketingPoint: number }> {
    const rows = await this.db.query<
      { game_coin: string; marketing_point: string }[]
    >(`SELECT game_coin, marketing_point FROM wallet WHERE user_id = $1`, [
      userId,
    ]);
    if (!rows.length) return { gameCoin: 0, marketingPoint: 0 };
    return {
      gameCoin: Number(rows[0].game_coin),
      marketingPoint: Number(rows[0].marketing_point),
    };
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
      // 顺序即外键顺序：所有表都直接引用 user，故只需保证 user 最后删。
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
        'home_stat',
        'pet_equip',
        'item_owned',
        'race_record',
        'daily',
        'ledger',
        'wallet',
        'pet',
      ]) {
        await this.db.query(`DELETE FROM ${table} WHERE user_id = $1`, [
          userId,
        ]);
      }
      await this.db.query(`DELETE FROM "user" WHERE id = $1`, [userId]);

      const keys = await this.redis.keys(`*:${userId}:*`);
      const more = await this.redis.keys(`*:${userId}`);
      const all = [...keys, ...more];
      if (all.length) await this.redis.del(...all);
    }
    this.userIds.length = 0;
    await this.app.close();
  }
}
