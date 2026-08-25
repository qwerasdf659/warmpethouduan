import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { DEX_ENTRIES } from '../dex.config';

const ENTRY_KEYS = DEX_ENTRIES.map((e) => e.key);

export class DexClaimDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  bizId: string;

  @IsString()
  @IsIn(ENTRY_KEYS)
  entryKey: string;
}
