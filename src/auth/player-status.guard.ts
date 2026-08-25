import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthUser } from './jwt-auth.guard';
import { PlayerStatusService } from './player-status.service';

/** 只读方法放行：封号只封写，保留查询以便客服解释与用户申诉。 */
const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * 封禁账号的写操作准入校验。必须排在 `JwtAuthGuard` 之后：
 * `@UseGuards(JwtAuthGuard, PlayerStatusGuard)`。
 *
 * 为什么需要它：`JwtAuthGuard` 只验签名不查库，而玩家令牌有效期 7 天。
 * 没有本守卫时，账号封禁后持有存量令牌的客户端仍能继续发奖、扣费、下兑换单，
 * 直到令牌自然过期。
 *
 * 这里每次写请求查一次库（主键命中），不加缓存：封禁是安全控制，
 * 缓存会引入「已封禁但仍放行」的窗口，而写请求本身必然还要打库，多这一次可忽略。
 */
@Injectable()
export class PlayerStatusGuard implements CanActivate {
  constructor(private readonly playerStatus: PlayerStatusService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    if (READ_ONLY_METHODS.has(req.method)) return true;

    const user = (req as Request & { user?: AuthUser }).user;
    if (!user?.userId) {
      // 说明 JwtAuthGuard 没跑或没挂，属于装配错误，按未授权处理而非放行
      throw new UnauthorizedException('缺少访问令牌');
    }

    await this.playerStatus.assertNotBanned(user.userId);
    return true;
  }
}
