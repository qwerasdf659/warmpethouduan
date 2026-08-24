import { IsString, MaxLength, MinLength } from 'class-validator';

export class FeedDto {
  /** 客户端生成的全局唯一操作 id，用于幂等 */
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  bizId: string;
}
