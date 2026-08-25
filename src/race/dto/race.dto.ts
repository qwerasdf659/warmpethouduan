import {
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RaceStartDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  bizId: string;

  /**
   * 不用 `@IsIn` 锁死赛道列表：赛道已是运营可配置项，
   * 模块加载时快照白名单会让后台新增的赛道永远校验不过。
   * 未知 key 由 `RaceService` 按当前配置判定。
   */
  @IsString()
  @MaxLength(32)
  trackKey: string;

  /** 参赛宠，缺省用当前出战宠。 */
  @IsOptional()
  @IsNumberString()
  petId?: string;
}

export class RaceSettleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  bizId: string;

  @IsNumberString()
  raceId: string;
}

/** 看广告类增值：raceId + 由 `POST /ad/token` 领到的一次性凭证。 */
export class RaceAdBoostDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  bizId: string;

  @IsNumberString()
  raceId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  adToken: string;
}
