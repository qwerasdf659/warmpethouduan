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
  ValidateIf,
} from 'class-validator';

/**
 * 交易标的。二者**必须恰好传一个**：
 *  - `instanceId` → 唯一物品（皮肤/配饰），交易的是「这一件」
 *  - `assetCode` + `qty` → 可堆叠资产（家具/消耗品），交易的是件数
 *
 * 用 `ValidateIf` 互斥而不是分两个 DTO：客户端只需要记一个请求形状，
 * 而「传了两个」或「都没传」在服务端会被 `SubjectResolverService.resolve` 明确拒绝。
 */
export class SubjectDto {
  @ValidateIf((o: SubjectDto) => !o.instanceId)
  @IsString()
  @IsNotEmpty()
  @MaxLength(48)
  assetCode?: string;

  @ValidateIf((o: SubjectDto) => !o.instanceId)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9999)
  qty?: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  instanceId?: string;
}

export class RecycleDto extends SubjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  bizId: string;
}

export class GiftDto extends SubjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  toUserId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  bizId: string;
}

export class CreateListingDto extends SubjectDto {
  /** 一价成交（fixed）或自由竞价（auction） */
  @IsIn(['fixed', 'auction'])
  mode: 'fixed' | 'auction';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  price: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  bizId: string;
}

export class BizIdDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  bizId: string;
}

export class BidDto extends BizIdDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  price: number;
}

export class BrowseListingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(48)
  assetCode?: string;

  @IsOptional()
  @IsIn(['fixed', 'auction'])
  mode?: 'fixed' | 'auction';

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
