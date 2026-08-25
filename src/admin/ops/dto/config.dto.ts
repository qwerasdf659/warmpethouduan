import { Allow, IsOptional, IsString, MaxLength } from 'class-validator';

/** 配置 upsert。value 为任意 JSON（@Allow 放行白名单校验）。 */
export class UpsertConfigDto {
  @Allow()
  value: unknown;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  description?: string;
}
