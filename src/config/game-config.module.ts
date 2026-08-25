import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GameConfig } from '../entities/game-config.entity';
import { GameConfigService } from './game-config.service';

/**
 * 玩法配置是横切关注点（6 个域 + 后台都要用），故设为全局模块，
 * 与 `RedisModule` 同样的处理，免得每个域都写一遍 import。
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([GameConfig])],
  providers: [GameConfigService],
  exports: [GameConfigService],
})
export class GameConfigModule {}
