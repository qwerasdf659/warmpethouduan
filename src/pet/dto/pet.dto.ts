import {
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** 互动动作入参。petId 省略则作用于当前出战宠。 */
export class PetActionDto {
  /** 客户端生成的全局唯一操作 id，用于幂等 */
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  bizId: string;

  @IsOptional()
  @IsNumberString()
  petId?: string;
}

export class CreatePetDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  bizId: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  nickname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  species?: string;
}

export class SetActivePetDto {
  @IsNumberString()
  petId: string;
}

/** GET /pet/state 的查询参数（全局 ValidationPipe 开了 forbidNonWhitelisted）。 */
export class PetStateQueryDto {
  @IsOptional()
  @IsNumberString()
  petId?: string;
}

/** 领取离线收益入参。 */
export class OfflineClaimDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  bizId: string;
}
