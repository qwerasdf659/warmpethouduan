import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class BreedStartDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  bizId: string;

  @IsString()
  @IsNotEmpty()
  petAId: string;

  @IsString()
  @IsNotEmpty()
  petBId: string;
}

export class BreedSpeedupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  bizId: string;

  @IsString()
  @IsNotEmpty()
  eggId: string;

  @IsIn(['ad', 'coin'])
  method: 'ad' | 'coin';

  @IsOptional()
  @IsString()
  adToken?: string;
}

export class BreedHatchDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  bizId: string;

  @IsString()
  @IsNotEmpty()
  eggId: string;
}
