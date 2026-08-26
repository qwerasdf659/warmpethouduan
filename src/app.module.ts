import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule } from '@nestjs/typeorm';
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
import { EconomyModule } from './economy/economy.module';
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
    EconomyModule,
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
  providers: [AppService],
})
export class AppModule {}
