import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class HomeBuyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  bizId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(48)
  assetCode: string;
}

export class PlaceFurnitureDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(48)
  assetCode: string;

  /**
   * 网格坐标（0 起，左上角）。省略则由服务端自动找空位。
   * 这里的上界只是防脏数据，真正的边界按 `home.grid` 配置在 Service 里判。
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(63)
  posX?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(63)
  posY?: number;
}

export class RemoveFurnitureDto {
  @IsNumberString()
  layoutId: string;
}
