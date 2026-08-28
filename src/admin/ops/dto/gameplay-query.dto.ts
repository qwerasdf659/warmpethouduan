import {
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * 玩法巡检列表的公共筛选项。
 *
 * `userId` 用 IsNumberString 而不是 IsInt：bigint 主键在 pg 下是字符串，转成
 * number 在超过 2^53 后会静默丢精度，查出来是另一个玩家的数据。
 */
export class ByUserQueryDto extends PaginationDto {
  @IsOptional()
  @IsNumberString()
  userId?: string;
}

export class QueryGachaDrawsDto extends ByUserQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(48)
  poolKey?: string;

  /** 只看出货（含稀有奖励）的那些抽，排查「保底没给」时用 */
  @IsOptional()
  @IsIn(['rare'])
  filter?: 'rare';
}

export class QueryGachaStatesDto extends ByUserQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(48)
  poolKey?: string;
}

export class QueryTradeOffersDto extends PaginationDto {
  /** 发起方或接收方任一命中即可 —— 客服拿到的只是「某个玩家」 */
  @IsOptional()
  @IsNumberString()
  userId?: string;

  @IsOptional()
  @IsIn(['pending', 'accepted', 'rejected', 'cancelled', 'expired'])
  status?: string;
}

export class QueryRaceRecordsDto extends ByUserQueryDto {
  @IsOptional()
  @IsIn(['pending', 'settled'])
  status?: 'pending' | 'settled';

  @IsOptional()
  @IsString()
  @MaxLength(32)
  trackKey?: string;
}

export class QueryMarketBidsDto extends PaginationDto {
  @IsOptional()
  @IsNumberString()
  listingId?: string;

  /** 按出价人玩家 id 筛（内部要经 account 表换算成 account_id） */
  @IsOptional()
  @IsNumberString()
  userId?: string;

  @IsOptional()
  @IsIn(['active', 'outbid', 'won', 'cancelled'])
  status?: string;
}

export class QueryAssetLotsDto extends PaginationDto {
  @IsOptional()
  @IsNumberString()
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(48)
  assetCode?: string;

  /** 只看有余额的批次：清零批次会把列表撑满，运营关心的是还没花完的 */
  @IsOptional()
  @IsIn(['remaining', 'expiring'])
  filter?: 'remaining' | 'expiring';
}

export class QueryItemInstancesDto extends PaginationDto {
  @IsOptional()
  @IsIn(['held', 'listed', 'escrowed', 'burned'])
  state?: string;
}
