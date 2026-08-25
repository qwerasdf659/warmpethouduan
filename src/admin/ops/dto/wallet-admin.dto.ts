import { Type } from 'class-transformer';
import {
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
