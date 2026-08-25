import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AdminJwtAuthGuard } from '../guards/admin-jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { Audit } from '../decorators/audit.decorator';
import { AdminAuditInterceptor } from '../audit/admin-audit.interceptor';
import { AdminPermissionService } from './admin-permission.service';
import { CreatePermissionDto } from './dto/permission.dto';

@Controller('admin/permissions')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminPermissionController {
  constructor(private readonly service: AdminPermissionService) {}

  @Get()
  @RequirePermissions('permission:read')
  findAll() {
    return this.service.findAll();
  }

  @Post()
  @RequirePermissions('permission:write')
  @Audit('创建权限点', 'admin_permission')
  create(@Body() dto: CreatePermissionDto) {
    return this.service.create(dto);
  }

  @Delete(':id')
  @RequirePermissions('permission:write')
  @Audit('删除权限点', 'admin_permission')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
