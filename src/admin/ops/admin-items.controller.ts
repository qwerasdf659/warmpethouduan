import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AdminAuditInterceptor } from '../audit/admin-audit.interceptor';
import { Audit } from '../decorators/audit.decorator';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { AdminJwtAuthGuard } from '../guards/admin-jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { AdminItemsService } from './admin-items.service';
import { CreateItemDefDto, UpdateItemDefDto } from './dto/item-def.dto';

/** 物品定义（换装/家具）管理。复用 config 权限。 */
@Controller('admin/items')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminItemsController {
  constructor(private readonly service: AdminItemsService) {}

  @Get()
  @RequirePermissions('config:read')
  list(@Query('type') type?: string) {
    return this.service.list(type);
  }

  @Post()
  @RequirePermissions('config:write')
  @Audit('新建物品', 'item_def')
  create(@Body() dto: CreateItemDefDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @RequirePermissions('config:write')
  @Audit('修改物品', 'item_def')
  update(@Param('id') id: string, @Body() dto: UpdateItemDefDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('config:write')
  @Audit('删除物品', 'item_def')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
