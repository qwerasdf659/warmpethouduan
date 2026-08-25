import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
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
