import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * 单局操作数硬上限。
 *
 * 与 `minigame.session.maxActionsPerSession` 的默认值保持一致，但这里必须是编译期
 * 常量（装饰器求值早于任何配置读取）。运营调小配置时由服务层按实际配置再卡一道；
 * 这里只作 DoS 面的最外层兜底，防止一个请求体就把内存/CPU 拖垮。
 */
const MAX_ACTIONS = 2000;

/**
 * 一次玩家操作。字段是通用占位（`t` 时刻、`x` 位置/输入），
 * 具体语义由各小游戏的回放算分器解释——服务端只按 seed + 操作序列重算分数，
 * 客户端上报的分数一律不采信。
 */
export class MinigameActionDto {
  @Type(() => Number)
  @IsNumber()
  t: number;

  @Type(() => Number)
  @IsNumber()
  x: number;
}

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

export class MinigameSettleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  bizId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  sessionId: string;

  @IsArray()
  @ArrayMaxSize(MAX_ACTIONS)
  @ValidateNested({ each: true })
  @Type(() => MinigameActionDto)
  actions: MinigameActionDto[];
}
