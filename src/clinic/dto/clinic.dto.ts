import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** 解锁诊所。bizId 走 `@Idempotent()` 的请求级去重。 */
export class UnlockDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  bizId: string;
}

/**
 * 接诊作答。
 *
 * `optionKey` 不用 `@IsIn` 锁死：候选方案由服务端按病例逐次生成，
 * 合法性只有加载具体病例后才能判定，交由 `ClinicService` 与 `answer_key` 比对。
 */
export class DiagnoseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  bizId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  caseId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  optionKey: string;
}
