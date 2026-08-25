import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AdminAuditInterceptor } from '../audit/admin-audit.interceptor';
import { Audit } from '../decorators/audit.decorator';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { AdminJwtAuthGuard } from '../guards/admin-jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { AdminConfigService } from './admin-config.service';
import { UpsertConfigDto } from './dto/config.dto';

@Controller('admin/config')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminConfigController {
  constructor(private readonly service: AdminConfigService) {}

  @Get()
  @RequirePermissions('config:read')
  list() {
    return this.service.list();
  }

  @Get(':key')
  @RequirePermissions('config:read')
  get(@Param('key') key: string) {
    return this.service.get(key);
  }

  @Put(':key')
  @RequirePermissions('config:write')
  @Audit('修改配置', 'config')
  upsert(@Param('key') key: string, @Body() dto: UpsertConfigDto) {
    return this.service.upsert(key, dto);
  }

  /** 恢复为代码内置默认值。 */
  @Post(':key/reset')
  @RequirePermissions('config:write')
  @Audit('恢复配置默认值', 'config')
  reset(@Param('key') key: string) {
    return this.service.reset(key);
  }

  @Delete(':key')
  @RequirePermissions('config:write')
  @Audit('删除配置', 'config')
  remove(@Param('key') key: string) {
    return this.service.remove(key);
  }
}
