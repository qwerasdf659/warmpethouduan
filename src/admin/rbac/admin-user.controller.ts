import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AdminJwtAuthGuard } from '../guards/admin-jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { Audit } from '../decorators/audit.decorator';
import { AdminAuditInterceptor } from '../audit/admin-audit.interceptor';
import { AdminUserService } from './admin-user.service';
import { PaginationDto } from '../dto/pagination.dto';
import {
  AssignUserRolesDto,
  CreateAdminUserDto,
  ResetPasswordDto,
  UpdateAdminUserDto,
} from './dto/admin-user.dto';

@Controller('admin/admin-users')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminUserController {
  constructor(private readonly service: AdminUserService) {}

  @Get()
  @RequirePermissions('admin:read')
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get(':id')
  @RequirePermissions('admin:read')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post()
  @RequirePermissions('admin:write')
  @Audit('创建管理员', 'admin_user')
  create(@Body() dto: CreateAdminUserDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('admin:write')
  @Audit('更新管理员', 'admin_user')
  update(@Param('id') id: string, @Body() dto: UpdateAdminUserDto) {
    return this.service.update(id, dto);
  }

  @Put(':id/roles')
  @RequirePermissions('admin:write')
  @Audit('分配管理员角色', 'admin_user')
  setRoles(@Param('id') id: string, @Body() dto: AssignUserRolesDto) {
    return this.service.setRoles(id, dto);
  }

  @Put(':id/password')
  @RequirePermissions('admin:write')
  @Audit('重置管理员密码', 'admin_user')
  resetPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto) {
    return this.service.resetPassword(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('admin:write')
  @Audit('删除管理员', 'admin_user')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
