import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AdminAuditInterceptor } from '../admin/audit/admin-audit.interceptor';
import { Audit } from '../admin/decorators/audit.decorator';
import { RequirePermissions } from '../admin/decorators/permissions.decorator';
import { AdminJwtAuthGuard } from '../admin/guards/admin-jwt-auth.guard';
import { RolesGuard } from '../admin/guards/roles.guard';
import { AdminEventService } from './admin-event.service';
import {
  CreateEventDto,
  EventProgressPageDto,
  ListEventsDto,
  UpdateEventDto,
} from './dto/event.dto';

/**
 * 限时活动管理后台（P12）。
 *
 * 读用 `event:read`、增删改用 `event:write`，与 admin-items 的
 * `config:read`/`config:write` 分权语义一致。
 */
@Controller('admin/events')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminEventController {
  constructor(private readonly service: AdminEventService) {}

  @Get()
  @RequirePermissions('event:read')
  list(@Query() q: ListEventsDto) {
    return this.service.list(q.page, q.pageSize);
  }

  @Post()
  @RequirePermissions('event:write')
  @Audit('新建活动', 'game_event')
  create(@Body() dto: CreateEventDto) {
    return this.service.create(dto);
  }

  @Patch(':key')
  @RequirePermissions('event:write')
  @Audit('修改活动', 'game_event')
  update(@Param('key') key: string, @Body() dto: UpdateEventDto) {
    return this.service.update(key, dto);
  }

  @Delete(':key')
  @RequirePermissions('event:write')
  @Audit('删除活动', 'game_event')
  remove(@Param('key') key: string) {
    return this.service.remove(key);
  }

  @Get(':key/progress')
  @RequirePermissions('event:read')
  progress(@Param('key') key: string, @Query() q: EventProgressPageDto) {
    return this.service.progressOf(key, q.page, q.pageSize);
  }
}
