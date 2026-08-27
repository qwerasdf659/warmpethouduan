import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { AuthUser } from '../auth/jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlayerStatusGuard } from '../auth/player-status.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';
import { ConditionService } from './condition.service';
import { ConditionsQueryDto, CureDto } from './dto/condition.dto';

/**
 * 疾病与治疗（P1）。路径挂在 /pet 下：`GET /pet/conditions`（纯读）、`POST /pet/cure`。
 * 与根路径的 `GET /health` 存活探针语义分离，字段与表名 pet_condition 对齐。
 */
@Controller('pet')
@UseGuards(JwtAuthGuard, PlayerStatusGuard)
export class ConditionController {
  constructor(private readonly conditions: ConditionService) {}

  @Get('conditions')
  list(@CurrentUser() user: AuthUser, @Query() q: ConditionsQueryDto) {
    return this.conditions.listConditions(user.userId, q.petId);
  }

  @Post('cure')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  cure(@CurrentUser() user: AuthUser, @Body() dto: CureDto) {
    return this.conditions.cure(user.userId, dto.bizId, dto.method, dto.petId);
  }
}
