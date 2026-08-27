import {
  Body,
  Controller,
  Get,
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
import { AdminThemeService } from './admin-theme.service';
import { UpdateThemeDto } from './dto/theme.dto';

/**
 * 后台外观主题。
 *
 * 与本模块其它控制器不同，守卫挂在方法上而不是类上——读接口必须匿名可访问：
 * 登录页本身要按主题渲染，而那时还没有 token。配色不是敏感信息，泄露的
 * 只是几个十六进制色值。写接口仍需 `config:write` 并落审计。
 */
@Controller('admin/ui/theme')
export class AdminThemeController {
  constructor(private readonly service: AdminThemeService) {}

  @Get()
  get() {
    return this.service.get();
  }

  @Put()
  @UseGuards(AdminJwtAuthGuard, RolesGuard)
  @UseInterceptors(AdminAuditInterceptor)
  @RequirePermissions('config:write')
  @Audit('修改后台外观', 'ui_theme')
  update(@Body() dto: UpdateThemeDto) {
    return this.service.update(dto.theme);
  }

  @Post('reset')
  @UseGuards(AdminJwtAuthGuard, RolesGuard)
  @UseInterceptors(AdminAuditInterceptor)
  @RequirePermissions('config:write')
  @Audit('恢复后台外观默认值', 'ui_theme')
  reset() {
    return this.service.reset();
  }
}
