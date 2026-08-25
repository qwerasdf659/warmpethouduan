import { IsString, MaxLength, MinLength } from 'class-validator';

export class DexClaimDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  bizId: string;

  /**
   * 不用 `@IsIn` 锁死图鉴条目：条目已是运营可配置项，
   * 模块加载时快照白名单会让后台新增的条目永远校验不过。
   * 未知 key 由 `DexService` 按当前配置判定。
   */
  @IsString()
  @MaxLength(32)
  entryKey: string;
}
