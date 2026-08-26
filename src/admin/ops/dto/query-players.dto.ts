import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryPlayersDto extends PaginationDto {
  /** 模糊匹配 玩家 id / openid / unionid */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  keyword?: string;
}
