import { Body, Controller, Get, Ip, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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

  /**
   * @Ip() 取的是 Express 的 req.ip，其是否等于真实客户端 IP 取决于 main.ts 里的
   * trust proxy 设置——配错会让整个 ingress 共用一个计数桶，见 TRUST_PROXY_HOPS。
   *
   * 限额写死而不读 THROTTLE_LIMIT：那个是给全站兜底用的、会被运维按流量调宽，
   * 登录端点不该跟着一起放宽。正常人不会一分钟登 10 次。
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  login(
    @Body() dto: AdminLoginDto,
    @Ip() ip: string,
  ): Promise<AdminLoginResult> {
    return this.auth.login(dto.username, dto.password, ip);
  }

  @Get('me')
  @UseGuards(AdminJwtAuthGuard)
  me(@CurrentAdmin() admin: AdminPrincipal) {
    return this.auth.buildProfile(admin.adminUserId);
  }
}
