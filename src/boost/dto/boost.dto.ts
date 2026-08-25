import {
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AD_SCENES, AdScene } from '../boost.config';

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

  /** 广告场景标识（可选，仅记录用） */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  scene?: string;
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
