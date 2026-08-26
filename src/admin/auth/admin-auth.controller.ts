import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AdminAuthService, AdminLoginResult } from './admin-auth.service';
import { AdminLoginDto } from '../dto/admin-login.dto';
import { AdminJwtAuthGuard } from '../guards/admin-jwt-auth.guard';
import { CurrentAdmin } from '../decorators/current-admin.decorator';
import type { AdminPrincipal } from '../admin-principal';

/**
 * 后台鉴权入口。/admin/auth/login 公开；/admin/auth/me 需登录。
 *
 * 归在 admin/ 下而不是 /auth/admin：后台的全部端点共用一个前缀，前端只需代理
 * 一条 `/admin` 规则，也不会顺带把玩家端的 /auth 命名空间暴露进后台开发服务器。
 */
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login')
  login(@Body() dto: AdminLoginDto): Promise<AdminLoginResult> {
    return this.auth.login(dto.username, dto.password);
  }

  @Get('me')
  @UseGuards(AdminJwtAuthGuard)
  me(@CurrentAdmin() admin: AdminPrincipal) {
    return this.auth.buildProfile(admin.adminUserId);
  }
}
