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
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { GAME_COIN, MARKETING_POINT } from '../../../ledger/ledger.types';

/** 后台全局流水查询。可按玩家 / 资产 / 原因筛选。 */
export class QueryLedgerDto extends PaginationDto {
  @IsOptional()
  @IsString()
  userId?: string;

  /**
   * 按资产筛选（`asset_def.code`）。留空 = 全部资产。
   *
   * 资产维度只有这一个：全站有三十多种资产，而「池」只有两个值——
   * 一条 `cons_snack +3` 在池维度下会显示成「游戏币 +3」，客服据此判断就会出错。
   */
  @IsOptional()
  @IsString()
  @MaxLength(48)
  assetCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  reason?: string;
}

/**
 * 发行/销毁日报查询。
 *
 * `days` 默认 30：通胀是趋势问题，看单日没有意义。上限 365 —— 再长就该导出
 * 到 BI 而不是在后台表格里翻。
 */
export class QueryDailyStatsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;

  @IsOptional()
  @IsString()
  @MaxLength(48)
  assetCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  reason?: string;
}

/**
 * 冲正一张凭证（风控清单 R7：争议处理 / 盗号追回）。
 *
 * 这是**唯一**的账务修复手段。刻意不提供「从流水重算余额」的工具：
 * 那类工具会忽略 `frozen` 与批次分桶，把带冻结的账户改错，
 * 修复工具本身就成了故障源。冲正则是追加一张反向凭证，原始证据一条不动。
 */
export class ReverseTxnDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  bizId: string;

  /** 冲正原因（记入审计，必填：无理由的资金操作不该存在） */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  reason: string;
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

  /** 货币资产 code（`game_coin` / `marketing_point`）。 */
  @IsIn([GAME_COIN, MARKETING_POINT])
  assetCode: string;

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

  /** 货币资产 code（`game_coin` / `marketing_point`）。 */
  @IsIn([GAME_COIN, MARKETING_POINT])
  assetCode: string;

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
