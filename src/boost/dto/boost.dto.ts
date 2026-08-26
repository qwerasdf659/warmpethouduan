import {
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AD_SCENES } from '../boost.config';
import type { AdScene } from '../boost.config';

/** 领取「看广告换增值」的一次性凭证。 */
export class AdTokenDto {
  @IsIn(AD_SCENES)
  scene: AdScene;
}

export class AdVerifyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  bizId: string;

  /**
   * `POST /ad/token`（scene=ad_reward）签发的一次性凭证，**必填**。
   * 与赛跑增值接口同一套风控：没有凭证就发币等于「客户端说看了广告就给」。
   */
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  adToken: string;
}

export class SpeedupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  bizId: string;

  @IsOptional()
  @IsNumberString()
  petId?: string;
}

export class StaminaRecoverDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  bizId: string;

  @IsOptional()
  @IsNumberString()
  petId?: string;
}
