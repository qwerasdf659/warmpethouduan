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
import { PaginationDto } from '../../../common/dto/pagination.dto';

/** 后台挂单查询。可按状态 / 模式 / 资产 / 卖家筛。 */
export class QueryListingsDto extends PaginationDto {
  @IsOptional()
  @IsIn(['listed', 'sold', 'cancelled', 'expired'])
  status?: 'listed' | 'sold' | 'cancelled' | 'expired';

  @IsOptional()
  @IsIn(['fixed', 'auction'])
  mode?: 'fixed' | 'auction';

  @IsOptional()
  @IsString()
  @MaxLength(48)
  assetCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  sellerUserId?: string;
}

/**
 * 强制撤单（违规挂单下架 / 纠纷处理）。
 *
 * `reason` 必填：强制介入玩家资产的操作没有理由不该存在，且它会随审计一起留痕。
 */
export class ForceCancelListingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  bizId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  reason: string;
}

/**
 * 单向净流出查询（风控清单 R4）。
 *
 * `days` 默认 7：单看一天的赠送完全正常，「A 长期只送 B」要跨天才有信号。
 */
export class QueryNetFlowDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;

  /** 净流出超过此值才列入（默认 0，即只要方向为净流出就列） */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  threshold?: number;
}
