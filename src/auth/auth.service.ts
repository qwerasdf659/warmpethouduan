import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClockService } from '../common/clock/clock.service';
import { User } from '../entities/user.entity';
import { WechatService } from '../wechat/wechat.service';
import { hashPassword, verifyPassword } from '../admin/utils/password.util';

export interface LoginResult {
  token: string;
  userId: string;
}

/**
 * 通用登录的 openid 前缀。与微信真 openid、mock openid 一样，都落在同一个
 * `user.openid` 唯一列上，靠前缀区分身份来源（provider）。
 *
 * 复用单列而非各建一列：绝大多数下游只认「一个稳定的玩家 id」，身份来源对它们透明；
 * 前缀既保证跨来源不撞号，也让运营在后台一眼看出账号类型。
 */
const DEVICE_OPENID_PREFIX = 'device_openid_';
const ACCOUNT_OPENID_PREFIX = 'account_openid_';

@Injectable()
export class AuthService {
  constructor(
    private readonly wechat: WechatService,
    private readonly jwt: JwtService,
    private readonly clock: ClockService,
    private readonly config: ConfigService,
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
    return this.issueToken(user);
  }

  /**
   * 设备登录（匿名 / 游客）：deviceId → 稳定 openid → 查或建 user → 自签 JWT。
   *
   * 面向 Unity 原生 / Steam 等无微信 code 的平台：客户端本地生成并持久化一个
   * 设备标识（如 GUID），据此稳定映射到同一玩家。无口令，故设备丢失即账号丢失——
   * 需要跨设备找回时改用「账号登录」。
   */
  async loginWithDevice(deviceId: string): Promise<LoginResult> {
    this.assertGenericLoginEnabled();
    const openid = `${DEVICE_OPENID_PREFIX}${deviceId}`;
    const user = await this.findOrCreateUser(openid);
    return this.issueToken(user);
  }

  /**
   * 账号注册：用户名 + 口令 → 建 user（username 列存名，openid 用 account 前缀占位）→ 自签 JWT。
   * 用户名已存在则 409（唯一性由 username 唯一索引兜底，仍先查一次给出友好报错）。
   */
  async registerAccount(
    username: string,
    password: string,
  ): Promise<LoginResult> {
    this.assertGenericLoginEnabled();
    const existing = await this.users.findOne({ where: { username } });
    if (existing) {
      throw new ConflictException('用户名已被注册');
    }

    const passwordHash = await hashPassword(password);
    let user: User;
    try {
      user = await this.users.save(
        this.users.create({
          openid: `${ACCOUNT_OPENID_PREFIX}${username}`,
          unionid: null,
          username,
          passwordHash,
        }),
      );
    } catch {
      // 并发下两个请求同时过了上面的存在性检查，唯一索引会拦下后者
      throw new ConflictException('用户名已被注册');
    }
    return this.issueToken(user);
  }

  /**
   * 账号登录：用户名 + 口令校验 → 自签 JWT。
   *
   * 用户名不存在与口令错误返回同一提示，避免账号枚举；用户不存在时仍做一次哑校验，
   * 抹平「存在/不存在」的响应时间差。在线爆破防护依赖全局 ThrottlerGuard 的
   * 每 IP 每端点频控（见 app.module）。
   */
  async loginWithAccount(
    username: string,
    password: string,
  ): Promise<LoginResult> {
    this.assertGenericLoginEnabled();
    const user = await this.users.findOne({ where: { username } });
    const invalid = new UnauthorizedException('用户名或密码错误');

    if (!user || !user.passwordHash) {
      // 抹平计时差：即便账号不存在也走一遍散列比较
      await verifyPassword(password, 'scrypt$00$00');
      throw invalid;
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) throw invalid;

    return this.issueToken(user);
  }

  /**
   * 设备账号绑定：给「当前已登录的匿名/设备玩家」设置用户名 + 口令，
   * 使其可跨设备用账号登录找回。openid 保持不变（设备登录仍命中原号），
   * 仅补 username + 口令散列——不迁移任何游戏数据，玩家 id 全程不变。
   *
   * 约束：每个玩家只能绑一次（已绑定再调 409）；用户名被他人占用亦 409。
   */
  async bindAccount(
    userId: string,
    username: string,
    password: string,
  ): Promise<LoginResult> {
    this.assertGenericLoginEnabled();
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('令牌无效或已过期');
    }
    if (user.username) {
      throw new ConflictException('该账号已绑定用户名，不能重复绑定');
    }

    const taken = await this.users.findOne({ where: { username } });
    if (taken) {
      throw new ConflictException('用户名已被占用');
    }

    user.username = username;
    user.passwordHash = await hashPassword(password);
    try {
      await this.users.save(user);
    } catch {
      // 并发绑定同一用户名，唯一索引兜底
      throw new ConflictException('用户名已被占用');
    }
    return this.issueToken(user);
  }

  /**
   * 统一签发：封禁拦截 → 刷新 last_seen_at → 签 JWT。
   * 所有 provider（微信/设备/账号）殊途同归都走这里，保证权威口径一致。
   */
  private async issueToken(user: User): Promise<LoginResult> {
    // 封禁账号拒绝签发新令牌（服务端权威）。
    if (user.status === 'banned') {
      throw new ForbiddenException(
        user.bannedReason
          ? `账号已被封禁：${user.bannedReason}`
          : '账号已被封禁',
      );
    }

    // 只刷「最后被看到」。离线结算走 offline_base_at，与本字段刻意分离——
    // 否则每次登录都会把尚未领取的离线时长冲掉（见 User.lastSeenAt 注释）。
    await this.users.update({ id: user.id }, { lastSeenAt: this.clock.now() });

    // 载荷只放 sub：服务端全程按 userId 定位，openid 没有任何读取点
    const token = await this.jwt.signAsync({ sub: user.id });
    return { token, userId: user.id };
  }

  private assertGenericLoginEnabled(): void {
    if (this.config.get<boolean>('game.genericLoginEnabled') !== true) {
      throw new NotFoundException('通用登录未启用');
    }
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
