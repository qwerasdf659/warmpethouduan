import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

export interface AuthUser {
  userId: string;
  openid: string;
}

/**
 * 校验 Authorization: Bearer <token>，通过后把 { userId, openid } 挂到 req.user。
 * 守卫先于拦截器执行，因此 IdempotencyInterceptor 能拿到 req.user。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('缺少访问令牌');
    }
    const token = header.slice('Bearer '.length).trim();
    try {
      const payload = this.jwt.verify<{ sub: string; openid: string }>(token, {
        secret: this.config.get<string>('jwt.secret'),
      });
      (req as Request & { user: AuthUser }).user = {
        userId: payload.sub,
        openid: payload.openid,
      };
      return true;
    } catch {
      throw new UnauthorizedException('令牌无效或已过期');
    }
  }
}
