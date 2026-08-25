import { IsIn, IsOptional } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import type { WalletPool } from '../economy.service';

export class LedgerQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn(['game', 'marketing'])
  pool?: WalletPool;
}
