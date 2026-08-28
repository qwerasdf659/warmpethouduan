import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryPlayersDto extends PaginationDto {
  /** 模糊匹配 玩家 id / openid / unionid */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  keyword?: string;

  /**
   * 按账号状态筛。
   *
   * 「列出所有封禁账号」是风控与申诉复核的日常动作，靠关键词搜不出来 ——
   * 在此之前只能翻页人工找，或者直接连库。
   */
  @IsOptional()
  @IsIn(['active', 'banned'])
  status?: 'active' | 'banned';
}
