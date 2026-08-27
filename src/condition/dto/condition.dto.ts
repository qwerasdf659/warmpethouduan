import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ConditionsQueryDto {
  @IsOptional()
  @IsString()
  petId?: string;
}

export class CureDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  bizId: string;

  @IsOptional()
  @IsString()
  petId?: string;

  @IsIn(['item', 'clinic'])
  method: 'item' | 'clinic';
}
