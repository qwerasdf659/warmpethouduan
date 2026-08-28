import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class LedgerQueryDto extends PaginationDto {
  /**
   * 按资产筛选（`asset_def.code`）。留空 = 全部资产。
   *
   * 只有这一个筛选维度，不再额外提供「积分池」：流水里不止两种货币，
   * 道具与消耗品的变动也有分录，玩家要能查「我那件皮肤是什么时候没的」。
   * 两个维度表达同一件事时，「按池筛」与「按 code 筛」的结果差异只能靠读代码解释。
   */
  @IsOptional()
  @IsString()
  @MaxLength(48)
  assetCode?: string;
}
