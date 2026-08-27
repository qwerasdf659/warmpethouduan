import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PvpGateway } from './pvp.gateway';

/**
 * 实时 PvP 通讯层（P6）。独立模块，仅依赖 JWT 校验（握手鉴权）。
 * 结算不在此：客户端收到 race:finish 后走 HTTP `POST /pvp/challenge`（幂等）。
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
      }),
    }),
  ],
  providers: [PvpGateway],
})
export class PvpRealtimeModule {}
