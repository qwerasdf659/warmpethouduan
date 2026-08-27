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

/**
 * 新建资产定义。
 *
 * 刻意**没有** `tradable` / `redeemable` / `gachaOutput` 三个合规开关：
 * 它们的组合被 DB CHECK 约束把死，放开需要显式迁移 + 追加决策记录。
 * 详见 `AdminItemsService` 的类注释。
 */
export class CreateItemDefDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(48)
  key: string;

  @IsIn(['skin', 'accessory', 'furniture', 'consumable', 'petpet'])
  type: 'skin' | 'accessory' | 'furniture' | 'consumable' | 'petpet';

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

  /** 家具占格宽（换装/消耗品省略） */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  gridW?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  gridH?: number;

  /**
   * 限量总量。`null`/省略 = 不限量。
   *
   * 仅对 `skin`/`accessory`（唯一物品）有意义 —— 只有实例化的资产才有编号。
   * **售出后不可下调**（见 `AdminItemsService.update`）。
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  mintLimit?: number | null;

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

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  gridW?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  gridH?: number;

  /** 限量总量。只能上调，不能低于已发行数量 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  mintLimit?: number | null;

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
