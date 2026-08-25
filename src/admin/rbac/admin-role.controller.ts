import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AdminJwtAuthGuard } from '../guards/admin-jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { Audit } from '../decorators/audit.decorator';
import { AdminAuditInterceptor } from '../audit/admin-audit.interceptor';
import { AdminRoleService } from './admin-role.service';
import {
  AssignRoleMenusDto,
  AssignRolePermissionsDto,
  CreateRoleDto,
  UpdateRoleDto,
} from './dto/role.dto';

@Controller('admin/roles')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminRoleController {
  constructor(private readonly service: AdminRoleService) {}

  @Get()
  @RequirePermissions('role:read')
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @RequirePermissions('role:read')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('role:write')
  @Audit('创建角色', 'admin_role')
  create(@Body() dto: CreateRoleDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('role:write')
  @Audit('更新角色', 'admin_role')
  update(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('role:write')
  @Audit('删除角色', 'admin_role')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Put(':id/permissions')
  @RequirePermissions('role:write')
  @Audit('分配角色权限', 'admin_role')
  setPermissions(
    @Param('id') id: string,
    @Body() dto: AssignRolePermissionsDto,
  ) {
    return this.service.setPermissions(id, dto);
  }

  @Put(':id/menus')
  @RequirePermissions('role:write')
  @Audit('分配角色菜单', 'admin_role')
  setMenus(@Param('id') id: string, @Body() dto: AssignRoleMenusDto) {
    return this.service.setMenus(id, dto);
  }
}
