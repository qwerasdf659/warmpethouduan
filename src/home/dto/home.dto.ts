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
  itemKey: string;
}

export class PlaceFurnitureDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(48)
  itemKey: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  posX?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  posY?: number;
}

export class RemoveFurnitureDto {
  @IsNumberString()
  layoutId: string;
}
