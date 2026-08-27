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
}

/**
 * 校验 Authorization: Bearer <token>，通过后把 { userId } 挂到 req.user。
 * 守卫先于拦截器执行，因此 IdempotencyInterceptor 能拿到 req.user。
 *
 * 只取 `sub`：玩法与账本一律按 userId 定位，openid 是微信侧的外部标识，
 * 服务端没有任何读取点。把它塞进令牌只会让每个请求都多带一份可关联到
 * 微信账号的身份信息，是白给的泄露面。
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
      const payload = this.jwt.verify<{ sub: string }>(token, {
        secret: this.config.get<string>('jwt.secret'),
      });
      (req as Request & { user: AuthUser }).user = { userId: payload.sub };
      return true;
    } catch {
      throw new UnauthorizedException('令牌无效或已过期');
    }
  }
}
