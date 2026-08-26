import { join } from 'path';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis/redis.module';
import configuration from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RedisModule } from './redis/redis.module';
import { DatabaseModule } from './database/database.module';
import { CommonModule } from './common/common.module';
import { GameConfigModule } from './config/game-config.module';
import { WechatModule } from './wechat/wechat.module';
import { AuthModule } from './auth/auth.module';
import { PetModule } from './pet/pet.module';
import { LedgerModule } from './ledger/ledger.module';
import { EconomyModule } from './economy/economy.module';
import { MarketModule } from './market/market.module';
import { DailyModule } from './daily/daily.module';
import { RaceModule } from './race/race.module';
import { ItemsModule } from './items/items.module';
import { HomeModule } from './home/home.module';
import { DexModule } from './dex/dex.module';
import { BoostModule } from './boost/boost.module';
import { ExchangeModule } from './exchange/exchange.module';
import { PromoModule } from './promo/promo.module';
import { GachaModule } from './gacha/gacha.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('db.host'),
        port: config.get<number>('db.port'),
        username: config.get<string>('db.user'),
        password: config.get<string>('db.password'),
        database: config.get<string>('db.name'),
        // 与 data-source.ts 同样用通配，实体注册表只有 src/entities/ 这一份真相源。
        // 曾经这里是显式数组：新增实体漏登记就运行时炸，而 data-source 那边漏登记会让
        // migration:generate 把「未注册」的表判成多余并生成 DROP TABLE。
        // `{.ts,.js}` 两种后缀都要：ts-jest/e2e 从 src 跑，生产从 dist 跑。
        entities: [join(__dirname, 'entities', '*.entity{.ts,.js}')],
        synchronize: false,
        // fail-fast：连接失败时快速报错退出，而非长时间静默重试
        retryAttempts: config.get<string>('env') === 'production' ? 5 : 2,
        retryDelay: 3000,
        applicationName: 'warmpet-api',
        // 透传给底层 pg Pool 的连接池 / keepAlive 参数
        extra: {
          max: config.get<number>('db.pool.max'),
          min: config.get<number>('db.pool.min'),
          connectionTimeoutMillis: config.get<number>(
            'db.pool.connectionTimeoutMs',
          ),
          idleTimeoutMillis: config.get<number>('db.pool.idleTimeoutMs'),
          keepAlive: config.get<boolean>('db.pool.keepAlive'),
          keepAliveInitialDelayMillis: config.get<number>(
            'db.pool.keepAliveInitialDelayMs',
          ),
          application_name: 'warmpet-api',
        },
      }),
    }),
    ScheduleModule.forRoot(),
    /*
     * 粗粒度限流（第二层，防的是「打爆整个服务」）。
     * 针对某个账号猜口令的精细防护在 LoginThrottleService（第一层），两层各管一件事。
     *
     * 计数键含 handler 名，故额度是每 IP 每端点各一份，不是全站一个桶。
     *
     * 存储走 Redis 而非默认的内存：ecosystem.config.js 现在是 instances:1，内存存储
     * 此刻是准的，但一旦调大 instances，内存存储会变成每 worker 各算一份，
     * 实际放行量翻 worker 倍数且没有任何报错——这种「悄悄失效」不能靠注释提醒来防。
     * 这里复用 REDIS_CLIENT 现成连接（传入实例时该库不会在销毁时断开它）。
     */
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, REDIS_CLIENT],
      useFactory: (config: ConfigService, redis: Redis) => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.get<number>('throttle.ttlMs') ?? 60_000,
            limit: config.get<number>('throttle.limit') ?? 100,
          },
        ],
        storage: new ThrottlerStorageRedisService(redis),
      }),
    }),
    // 运营后台前端（Ant Design Pro 构建产物）挂在 /console，SPA 深链回退 index.html。
    // API 路由（/admin、/auth、/pet、/health）不在 /console 下，互不干扰。
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'admin-web', 'dist'),
      serveRoot: '/console',
      serveStaticOptions: { index: ['index.html'] },
    }),
    RedisModule,
    DatabaseModule,
    CommonModule,
    GameConfigModule,
    WechatModule,
    AuthModule,
    PetModule,
    LedgerModule,
    EconomyModule,
    MarketModule,
    DailyModule,
    RaceModule,
    ItemsModule,
    HomeModule,
    DexModule,
    BoostModule,
    ExchangeModule,
    PromoModule,
    GachaModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // 全局生效：新增控制器默认就在限流之内，不需要谁记得挂装饰器
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
