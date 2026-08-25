import { Transform } from 'class-transformer';
import { IsBooleanString, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../dto/pagination.dto';

export class QueryAuditDto extends PaginationDto {
  @IsOptional()
  @IsString()
  adminUserId?: string;

  @IsOptional()
  @IsBooleanString()
  @Transform(({ value }) => value)
  success?: string;
}
