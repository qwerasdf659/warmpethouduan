import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AdminAuthService, AdminLoginResult } from './admin-auth.service';
import { AdminLoginDto } from '../dto/admin-login.dto';
import { AdminJwtAuthGuard } from '../guards/admin-jwt-auth.guard';
import { CurrentAdmin } from '../decorators/current-admin.decorator';
import type { AdminPrincipal } from '../admin-principal';

/**
 * 后台鉴权入口。/auth/admin/login 公开；/auth/admin/me 需登录。
 * 注意路由前缀是 /auth/admin（与玩家端 /auth 同级但独立）。
 */
@Controller('auth/admin')
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
