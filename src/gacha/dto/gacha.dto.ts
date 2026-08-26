import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class DrawGachaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(48)
  poolKey: string;

  /** 只开放 1 与 10：中间档位既无定价也让保底判定复杂化 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([1, 10])
  times?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  bizId: string;
}

export class GachaHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
