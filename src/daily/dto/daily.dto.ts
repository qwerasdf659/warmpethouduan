import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * bizId 供 `IdempotencyInterceptor` 做请求级去重（Redis）；
 * 奖励发放的持久幂等键由服务端按业务日派生，不采信客户端。
 */
export class CheckinDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  bizId: string;
}

export class ClaimTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  bizId: string;

  /**
   * 不在此处用 `@IsIn` 锁死任务列表：任务已是运营可配置项，
   * 模块加载时快照白名单会导致「后台新增的任务永远校验不过」。
   * 未知 key 由 `DailyService` 按当前配置判定。
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  taskKey: string;
}
