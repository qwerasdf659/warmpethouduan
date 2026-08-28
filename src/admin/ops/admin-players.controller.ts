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
import { AdminPlayerDossierService } from './admin-player-dossier.service';
import { AdminPlayersService } from './admin-players.service';
import {
  AdjustPetDto,
  BanPlayerDto,
  GrantItemDto,
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
  constructor(
    private readonly service: AdminPlayersService,
    private readonly dossier: AdminPlayerDossierService,
  ) {}

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

  /**
   * 玩法档案：签到 / 图鉴领取 / 收货地址 / 扭蛋保底 / 宠物病症·穿戴·技巧 /
   * 唯一物品实例。与 `:id` 分开，让抽屉能按需懒加载而不拖慢第一屏。
   *
   * 路由必须放在 `:id` **之后**声明也无妨（路径段不同不会打架），但要放在
   * 任何 `:id/:sub` 通配之前 —— 本控制器没有通配，故安全。
   */
  @Get(':id/dossier')
  @RequirePermissions('player:read')
  playerDossier(@Param('id') id: string) {
    return this.dossier.dossier(id);
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

  /**
   * 补发装扮/家具/背景。走独立的 `item:grant` 而不是 `player:write`：
   * 发外观和封号是两类风险完全不同的操作，客服该能补发但不该能封号。
   */
  @Post(':id/items/grant')
  @RequirePermissions('item:grant')
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  @Audit('补发物品', 'item')
  grantItem(@Param('id') id: string, @Body() dto: GrantItemDto) {
    return this.service.grantItem(id, dto);
  }
}
