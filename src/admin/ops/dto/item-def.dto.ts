import { Type } from 'class-transformer';
import {
  Allow,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateItemDefDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(48)
  key: string;

  @IsIn(['skin', 'accessory', 'furniture'])
  type: 'skin' | 'accessory' | 'furniture';

  @IsString()
  @IsNotEmpty()
  @MaxLength(48)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  slot?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  price: number;

  @IsIn(['game', 'marketing'])
  pool: 'game' | 'marketing';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  comfort?: number;

  @Allow()
  meta?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}

export class UpdateItemDefDto {
  @IsOptional()
  @IsString()
  @MaxLength(48)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  slot?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsIn(['game', 'marketing'])
  pool?: 'game' | 'marketing';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  comfort?: number;

  @Allow()
  meta?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}
