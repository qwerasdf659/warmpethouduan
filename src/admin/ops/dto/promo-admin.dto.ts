import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * 生成一批兑换码。
 *
 * `count` 与 `maxUses` 表达两种运营形态，别混用：
 *  - 线下印码：`count = 5000, maxUses = 1`（五千张各用一次）
 *  - 合作发券：`count = 1, maxUses = 5000`（一个码五千人可用，每人一次）
 *
 * `count` 上界 5000 是单次请求的保护（生码是同步写库）；要更多就分批调。
 */
export class CreatePromoBatchDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(48)
  batch: string;

  @IsIn(['game', 'marketing'])
  pool: 'game' | 'marketing';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  amount: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  count: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  maxUses?: number;

  /** 过期时间（ISO8601）；不传 = 永不过期 */
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  bizId: string;
}

export class QueryPromoCodeDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(48)
  batch?: string;

  /** 精确查码（会做同样的归一化） */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  code?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  enabled?: boolean;
}

export class QueryPromoRedemptionDto extends PaginationDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(48)
  batch?: string;
}

/** 停用/启用一批或单个码。 */
export class TogglePromoDto {
  @IsBoolean()
  enabled: boolean;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  bizId: string;
}
