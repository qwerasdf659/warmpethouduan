import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class MinigameStartDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  bizId: string;

  /**
   * 不用 `@IsIn` 锁死游戏 key：目录是运营可配置项，
   * 模块加载时的白名单会让后台新增的小游戏永远校验不过。
   * 未知 key 由 `MinigameService` 按当前配置判定。
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  gameKey: string;
}

/**
 * 翻一张牌。
 *
 * 只有牌位下标一个入参——过程数据全部由服务端记账，客户端没有可上报的东西。
 * 上限 63 对齐 `minigame.games[].pairs` 的配置上限（32 对 = 64 张牌）；
 * 真正的越界判定在服务层按当局实际牌位数做，这里只挡明显的垃圾请求。
 */
export class MinigameFlipDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  sessionId: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(63)
  index: number;
}

/**
 * 结算。
 *
 * **不收任何过程数据**：分数完全由服务端记录的对局进度派生。
 * `bizId` 只用于请求级幂等（弱网重试），真正的持久幂等键是对局 id。
 */
export class MinigameSettleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  bizId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  sessionId: string;
}
