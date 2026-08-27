import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class TricksQueryDto {
  @IsOptional()
  @IsString()
  petId?: string;
}

export class TrickActionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  bizId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  trickKey: string;

  @IsOptional()
  @IsString()
  petId?: string;
}
