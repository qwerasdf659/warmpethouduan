import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

/**
 * 玩家提交兑换码。
 *
 * 长度上界给到 40 而不是生码长度（10）：玩家会带着连字符、空格来提交，
 * 归一化发生在 Service 里，DTO 这层只防超长字符串。
 */
export class RedeemPromoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  bizId: string;
}

export class MyRedemptionQueryDto extends PaginationDto {}
