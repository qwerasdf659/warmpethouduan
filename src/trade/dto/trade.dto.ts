import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class TradeItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(48)
  assetCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  qty?: number;

  @IsOptional()
  @IsString()
  instanceId?: string;
}

export class TradeOfferDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  bizId: string;

  @IsString()
  @IsNotEmpty()
  toUserId: string;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => TradeItemDto)
  fromItems: TradeItemDto[] = [];

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => TradeItemDto)
  toItems: TradeItemDto[] = [];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  fromCoin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  toCoin?: number;
}

export class TradeRespondDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  bizId: string;

  @IsString()
  @IsNotEmpty()
  offerId: string;

  @IsIn(['accept', 'reject'])
  action: 'accept' | 'reject';
}

export class TradeCancelDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  bizId: string;

  @IsString()
  @IsNotEmpty()
  offerId: string;
}

export class TradeInboxDto extends PaginationDto {
  @IsOptional()
  @IsIn(['incoming', 'outgoing'])
  box?: 'incoming' | 'outgoing';
}
