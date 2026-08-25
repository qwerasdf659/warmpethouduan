import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryOrdersDto extends PaginationDto {
  @IsOptional()
  @IsIn(['pending', 'shipped', 'cancelled'])
  status?: 'pending' | 'shipped' | 'cancelled';

  @IsOptional()
  @IsString()
  userId?: string;
}

export class ShipOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  trackingNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string;
}

export class CancelOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
