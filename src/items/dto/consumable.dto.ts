import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** 购买消耗品。`qty` 上界 99 与后台补发口径一致，防误填成天文数字。 */
export class BuyConsumableDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(48)
  itemKey: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  qty?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  bizId: string;
}

/**
 * 使用一份消耗品。
 *
 * **一次只用一份**：批量使用会让「喂到饱食度上限就该停」这件事变成服务端猜测，
 * 而多喂的部分被 clamp 掉就是玩家花掉的道具凭空消失。要连喂就连点。
 */
export class UseConsumableDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(48)
  itemKey: string;

  @IsOptional()
  @IsString()
  petId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  bizId: string;
}
