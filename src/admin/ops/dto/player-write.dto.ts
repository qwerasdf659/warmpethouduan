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

/** 封禁玩家。bizId 幂等，reason 记入审计与账号封禁原因。 */
export class BanPlayerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  bizId: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

/** 解封玩家。 */
export class UnbanPlayerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  bizId: string;
}

/**
 * 补发装扮/家具。
 *
 * 补偿此前只能发币，客服遇到「买了皮肤没到账」「活动承诺送限定款」只能折算成币，
 * 而限定外观没法用币买回来。这里按 `itemKey` 直接发放。
 */
export class GrantItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  bizId: string;

  /** 物品业务键，如 `skin_tiger`。不校验类型：装扮、家具、背景都可发。 */
  @IsString()
  @IsNotEmpty()
  @MaxLength(48)
  itemKey: string;

  /** 发放数量。上限 99 是防手滑多打一个 0 就送出上万件。 */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  qty?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

/**
 * 宠物补偿/纠偏。数值字段均可选（未给则不动）。
 * mode: set 绝对赋值 | delta 增减（默认 delta）。
 */
export class AdjustPetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  bizId: string;

  /** 目标宠 id；缺省则调整当前出战宠。 */
  @IsOptional()
  @IsString()
  petId?: string;

  @IsOptional()
  @IsIn(['set', 'delta'])
  mode?: 'set' | 'delta';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;

  @IsOptional()
  @IsInt()
  hunger?: number;

  @IsOptional()
  @IsInt()
  mood?: number;

  @IsOptional()
  @IsInt()
  cleanliness?: number;

  @IsOptional()
  @IsInt()
  stamina?: number;

  @IsOptional()
  @IsInt()
  intimacy?: number;

  @IsOptional()
  @IsInt()
  exp?: number;
}
