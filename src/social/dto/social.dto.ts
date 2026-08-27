import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LikeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  bizId: string;

  @IsString()
  @IsNotEmpty()
  userId: string;
}
