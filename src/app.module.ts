import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RedisModule } from './redis/redis.module';
import { CommonModule } from './common/common.module';
import { WechatModule } from './wechat/wechat.module';
import { AuthModule } from './auth/auth.module';
import { PetModule } from './pet/pet.module';
import { User } from './entities/user.entity';
import { Pet } from './entities/pet.entity';

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
        entities: [User, Pet],
        synchronize: false,
      }),
    }),
    ScheduleModule.forRoot(),
    RedisModule,
    CommonModule,
    WechatModule,
    AuthModule,
    PetModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
