import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import {
  ADMIN_TOKEN_TYPE,
  AdminJwtPayload,
  AdminPrincipal,
} from '../admin-principal';

/**
 * 校验后台 Bearer token，且要求 payload.typ === 'admin'（与玩家端 token 隔离），
 * 通过后把 { adminUserId, username } 挂到 req.admin。
 * 守卫先于拦截器执行，故审计拦截器能拿到 req.admin。
 */
@Injectable()
export class AdminJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('缺少后台访问令牌');
    }
    const token = header.slice('Bearer '.length).trim();
    try {
      const payload = this.jwt.verify<AdminJwtPayload>(token, {
        secret: this.config.get<string>('jwt.secret'),
      });
      if (payload.typ !== ADMIN_TOKEN_TYPE) {
        throw new UnauthorizedException('令牌类型不匹配');
      }
      (req as Request & { admin: AdminPrincipal }).admin = {
        adminUserId: payload.sub,
        username: payload.username,
      };
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('后台令牌无效或已过期');
    }
  }
}
