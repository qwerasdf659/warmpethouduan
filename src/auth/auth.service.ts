import { ForbiddenException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClockService } from '../common/clock/clock.service';
import { User } from '../entities/user.entity';
import { WechatService } from '../wechat/wechat.service';

export interface LoginResult {
  token: string;
  userId: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly wechat: WechatService,
    private readonly jwt: JwtService,
    private readonly clock: ClockService,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  /**
   * 微信登录：code → openid/unionid → 查或建 user → 自签 JWT。
   * 身份优先级：有 unionid 用 unionid 认人，否则用 openid。
   */
  async login(code: string): Promise<LoginResult> {
    const session = await this.wechat.code2Session(code);
    const user = await this.findOrCreateUser(session.openid, session.unionid);

    // 封禁账号拒绝签发新令牌（服务端权威）。
    if (user.status === 'banned') {
      throw new ForbiddenException(
        user.bannedReason
          ? `账号已被封禁：${user.bannedReason}`
          : '账号已被封禁',
      );
    }

    // 刷新离线结算基准：elapsed = min(客户端申报, now − last_seen_at)
    await this.users.update({ id: user.id }, { lastSeenAt: this.clock.now() });

    const token = await this.jwt.signAsync({
      sub: user.id,
      openid: user.openid,
    });
    return { token, userId: user.id };
  }

  private async findOrCreateUser(
    openid: string,
    unionid?: string,
  ): Promise<User> {
    if (unionid) {
      const byUnion = await this.users.findOne({ where: { unionid } });
      if (byUnion) return byUnion;
    }

    const byOpenid = await this.users.findOne({ where: { openid } });
    if (byOpenid) {
      // 补齐后来才拿到的 unionid
      if (unionid && !byOpenid.unionid) {
        byOpenid.unionid = unionid;
        return this.users.save(byOpenid);
      }
      return byOpenid;
    }

    const created = this.users.create({ openid, unionid: unionid ?? null });
    return this.users.save(created);
  }
}
