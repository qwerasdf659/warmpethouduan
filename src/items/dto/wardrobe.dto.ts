import {
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class BuyItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  bizId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(48)
  assetCode: string;
}

export class EquipDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(48)
  assetCode: string;

  @IsOptional()
  @IsNumberString()
  petId?: string;
}

export class UnequipDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(24)
  slot: string;

  @IsOptional()
  @IsNumberString()
  petId?: string;
}
