import { IsBooleanString, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryAuditDto extends PaginationDto {
  @IsOptional()
  @IsString()
  adminUserId?: string;

  /** 'true' | 'false'；查询串里只会是字符串，由 service 转布尔。 */
  @IsOptional()
  @IsBooleanString()
  success?: string;
}
