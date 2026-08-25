import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreatePermissionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(128)
  @Matches(/^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/, {
    message: 'code 需形如 domain:action（小写，如 player:read）',
  })
  code: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  group?: string;
}
