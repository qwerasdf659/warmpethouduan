import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class AccountAuthDto {
  /**
   * 用户名。作为身份键的一部分写入 openid（account_openid_<用户名>），
   * 故限定字符集与长度：长度上限留足前缀空间（openid 列 64 字符）。
   */
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: '用户名仅允许字母、数字、下划线与连字符',
  })
  @MinLength(3)
  @MaxLength(32)
  username: string;

  @IsString()
  @MinLength(6, { message: '密码至少 6 位' })
  @MaxLength(128, { message: '密码至多 128 位' })
  password: string;
}
