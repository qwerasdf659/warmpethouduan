import {
  IsBoolean,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class RedeemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  bizId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(48)
  exchangeKey: string;

  /** 实物兑换必填收货地址 id。 */
  @IsOptional()
  @IsNumberString()
  addressId?: string;
}

export class OrderQueryDto extends PaginationDto {}

export class CreateAddressDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  receiver: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  region: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  detail: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAddressDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  receiver?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  region?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  detail?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
