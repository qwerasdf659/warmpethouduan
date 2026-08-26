import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/** 后台全局流水查询。可按玩家 / 池 / 原因筛选。 */
export class QueryLedgerDto extends PaginationDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsIn(['game', 'marketing'])
  pool?: 'game' | 'marketing';

  @IsOptional()
  @IsString()
  @MaxLength(32)
  reason?: string;
}

/**
 * 后台人工发币/扣币。amount 为正整数绝对值，direction 决定加/减；
 * 拆成两字段而非允许负数，避免运营误填正负号导致反向操作。
 */
export class GrantWalletDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  bizId: string;

  @IsIn(['game', 'marketing'])
  pool: 'game' | 'marketing';

  @IsIn(['grant', 'deduct'])
  direction: 'grant' | 'deduct';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

/**
 * 批量发币/扣币。
 *
 * 收显式 `userIds` 而不是「按条件筛选」：条件式批量的杀伤面在运营点下去之前
 * 是看不见的（写错一个条件就是全服发币），而名单式的必须先把人捞出来、
 * 数量摆在眼前才能提交。上限 200 是单次请求的保护，更多分批调。
 */
export class GrantWalletBulkDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  bizId: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  userIds: string[];

  @IsIn(['game', 'marketing'])
  pool: 'game' | 'marketing';

  @IsIn(['grant', 'deduct'])
  direction: 'grant' | 'deduct';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
