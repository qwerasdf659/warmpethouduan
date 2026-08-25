import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AdminJwtAuthGuard } from '../guards/admin-jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { Audit } from '../decorators/audit.decorator';
import { AdminAuditInterceptor } from '../audit/admin-audit.interceptor';
import { AdminMenuService } from './admin-menu.service';
import { CreateMenuDto, UpdateMenuDto } from './dto/menu.dto';

@Controller('admin/menus')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminMenuController {
  constructor(private readonly service: AdminMenuService) {}

  @Get()
  @RequirePermissions('menu:read')
  findAll() {
    return this.service.findAll();
  }

  @Post()
  @RequirePermissions('menu:write')
  @Audit('创建菜单', 'admin_menu')
  create(@Body() dto: CreateMenuDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('menu:write')
  @Audit('更新菜单', 'admin_menu')
  update(@Param('id') id: string, @Body() dto: UpdateMenuDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('menu:write')
  @Audit('删除菜单', 'admin_menu')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
