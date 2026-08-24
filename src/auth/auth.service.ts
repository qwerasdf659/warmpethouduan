import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
