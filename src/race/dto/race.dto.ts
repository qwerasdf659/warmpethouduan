import {
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { RACE_TRACKS } from '../race.config';

const TRACK_KEYS = RACE_TRACKS.map((t) => t.key);

export class RaceStartDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  bizId: string;

  @IsString()
  @IsIn(TRACK_KEYS)
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
