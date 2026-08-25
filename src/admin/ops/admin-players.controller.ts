import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { AdminAuditInterceptor } from '../audit/admin-audit.interceptor';
import { Audit } from '../decorators/audit.decorator';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { AdminJwtAuthGuard } from '../guards/admin-jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { AdminPlayersService } from './admin-players.service';
import {
  AdjustPetDto,
  BanPlayerDto,
  UnbanPlayerDto,
} from './dto/player-write.dto';
import { QueryPlayersDto } from './dto/query-players.dto';

/**
 * 玩家管理：只读查询（player:read）+ 受控写操作（player:write / pet:write）。
 * 写操作均带 bizId 幂等（IdempotencyInterceptor）并落审计（@Audit）。
 */
@Controller('admin/players')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminPlayersController {
  constructor(private readonly service: AdminPlayersService) {}

  @Get()
  @RequirePermissions('player:read')
  list(@Query() q: QueryPlayersDto) {
    return this.service.list(q);
  }

  @Get(':id')
  @RequirePermissions('player:read')
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Post(':id/ban')
  @RequirePermissions('player:write')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  @Audit('封禁玩家', 'player')
  ban(@Param('id') id: string, @Body() dto: BanPlayerDto) {
    return this.service.ban(id, dto.reason);
  }

  @Post(':id/unban')
  @RequirePermissions('player:write')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  @Audit('解封玩家', 'player')
  unban(@Param('id') id: string, @Body() _dto: UnbanPlayerDto) {
    return this.service.unban(id);
  }

  @Post(':id/pet/adjust')
  @RequirePermissions('pet:write')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  @Audit('宠物补偿调整', 'pet')
  adjustPet(@Param('id') id: string, @Body() dto: AdjustPetDto) {
    return this.service.adjustPet(id, dto);
  }
}
