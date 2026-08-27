import {
  Allow,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import type { GameEventType } from '../../entities/game-event.entity';

/** 活动类型白名单。与 `GameEventType` 保持一致。 */
const EVENT_TYPES = ['gacha_pool', 'shop', 'task', 'login'] as const;

// ---------------------------------------------------------------- 玩家端

/** GET /event/progress 查询参数。 */
export class EventProgressQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(48)
  eventKey: string;
}

/** POST /event/claim 请求体。 */
export class EventClaimDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  bizId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(48)
  eventKey: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(48)
  taskKey: string;
}

// ---------------------------------------------------------------- 后台

/** GET /admin/events 列表分页（复用通用分页）。 */
export class ListEventsDto extends PaginationDto {}

/** GET /admin/events/:key/progress 玩家进度分页。 */
export class EventProgressPageDto extends PaginationDto {}

/**
 * 新建活动。
 *
 * `payload` 用 `@Allow()` 放行任意 JSON：奖池/商品/任务链的结构因活动类型而异
 * （`task` 才有 `payload.tasks`），后台是运营的 JSON 编辑器，不该在这里锁死 schema。
 */
export class CreateEventDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(48)
  key: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name: string;

  @IsIn(EVENT_TYPES)
  type: GameEventType;

  /** 活动开始时间（ISO 8601，存 UTC）。 */
  @IsISO8601()
  startsAt: string;

  /** 活动结束时间（ISO 8601，存 UTC）。 */
  @IsISO8601()
  endsAt: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  banner?: string | null;

  @IsOptional()
  @Allow()
  payload?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/** 更新活动（全字段可选，key 不可改）。 */
export class UpdateEventDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsIn(EVENT_TYPES)
  type?: GameEventType;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  banner?: string | null;

  @IsOptional()
  @Allow()
  payload?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
