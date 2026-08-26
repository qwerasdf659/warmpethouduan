import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import type { WalletPool } from '../economy.service';

export class LedgerQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn(['game', 'marketing'])
  pool?: WalletPool;

  /**
   * 按具体资产筛选（`asset_def.code`）。与 `pool` 同时给时本项胜出。
   *
   * 重构后流水里不止两种货币：道具与消耗品的变动也有分录，
   * 玩家要能查「我那件皮肤是什么时候没的」。
   */
  @IsOptional()
  @IsString()
  @MaxLength(48)
  assetCode?: string;
}
