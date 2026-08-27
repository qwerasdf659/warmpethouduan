import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class ChallengeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  bizId: string;

  @IsString()
  @IsNotEmpty()
  opponentUserId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  trackKey: string;
}

export class HistoryQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn(['challenger', 'opponent'])
  role?: 'challenger' | 'opponent';
}
