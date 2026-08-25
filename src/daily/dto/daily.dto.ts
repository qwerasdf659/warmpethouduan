import {
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DAILY_TASKS } from '../daily.config';

const TASK_KEYS = DAILY_TASKS.map((t) => t.key);

export class CheckinDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  bizId: string;
}

export class ClaimTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  bizId: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(TASK_KEYS)
  taskKey: string;
}
