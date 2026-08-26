import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';

/**
 * 后台登录爆破防护（第一层：针对「猜某个账号的口令」）。
 *
 * scrypt 散列保护的是「库被拖走之后」，它完全不保护在线爆破——攻击者不需要看到散列，
 * 只要能无限次提交猜测。而后台超管持有 wallet:write / promo:write / config:write，
 * 攻破一个后台账号等于攻破整个经济系统。
 *
 * 计数写法照抄 PromoService 的 assertUnderLimit/bumpCounter/readCounter，
 * 但**软失败方向相反**，见 readCounter 上的注释。
 */

/**
 * 锁定窗口。
 *
 * 已锁定后再来的请求在 assertNotLocked 就被挡下、不再计数，因此 TTL **不会**被持续
 * 攻击无限续期——15 分钟后自动解锁。这是刻意的：若每次尝试都续期，任何人只要拿着
 * 一个已知的管理员用户名不停打，就能把该账号永久锁死，把防爆破变成拒绝服务。
 * 代价是攻击者每 15 分钟能试 5 次（约 480 次/天），对随机长口令毫无威胁。
 */
const WINDOW_SEC = 15 * 60;
/** 单账号失败上限：达到即锁定，锁定期内口令正确也拒绝。 */
const USER_LIMIT = 5;
/** 单 IP 失败上限：比账号宽松得多，防的是换着账号名撞库。 */
const IP_LIMIT = 20;

@Injectable()
export class LoginThrottleService {
  private readonly logger = new Logger(LoginThrottleService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * 口令校验**之前**调用。超限则抛出与口令错误完全相同的异常。
   *
   * 提示必须一致：若锁定时返回「账号已锁定」这类区别对待的文案，攻击者就能用它
   * 反推「刚才那次猜的口令是对的」——把锁定机制本身变成一个口令预言机。
   */
  async assertNotLocked(username: string, ip: string): Promise<void> {
    const [userFails, ipFails] = await Promise.all([
      this.readCounter(this.userKey(username)),
      this.readCounter(this.ipKey(ip)),
    ]);
    if (userFails >= USER_LIMIT || ipFails >= IP_LIMIT) {
      this.logger.warn(
        `后台登录被频控拦截 username=${username} ip=${ip} ` +
          `userFails=${userFails}/${USER_LIMIT} ipFails=${ipFails}/${IP_LIMIT}`,
      );
      throw new UnauthorizedException('用户名或密码错误');
    }
  }

  /** 口令校验失败后调用。按 username 与 IP 双键各记一次。 */
  async recordFailure(username: string, ip: string): Promise<void> {
    await Promise.all([
      this.bumpCounter(this.userKey(username)),
      this.bumpCounter(this.ipKey(ip)),
    ]);
  }

  /**
   * 登录成功后调用，清零该账号的失败计数。
   *
   * 只清账号键、**不清 IP 键**：账号键是给「手滑输错三次的运营」用的，不清会被自己的
   * 历史失败慢慢锁死；IP 键防的是撞库，若登录成功就清零，一个持有任意有效账号的攻击者
   * 便能每 20 次重置一遍 IP 预算，第二层防护等于不存在。
   */
  async clearFailures(username: string): Promise<void> {
    try {
      await this.redis.del(this.userKey(username));
    } catch (err) {
      this.logger.warn(`后台登录失败计数清零失败（已忽略）: ${this.msg(err)}`);
    }
  }

  private userKey(username: string): string {
    return `login:fail:admin:${username}`;
  }

  private ipKey(ip: string): string {
    return `login:fail:ip:${ip}`;
  }

  /**
   * 读计数。**Redis 故障时拒绝登录，而不是放行。**
   *
   * 这与 PromoService 的方向刻意相反：兑换码的频控读失败按 0 处理（软失败不死亡，
   * 不让加固项拖垮主功能），但登录放行等于给攻击者一条「先打挂 Redis 再爆破」的路径。
   * 后人「统一软失败风格」时不要把这里改反。
   */
  private async readCounter(key: string): Promise<number> {
    try {
      const v = await this.redis.get(key);
      return v ? Number(v) : 0;
    } catch (err) {
      this.logger.error(`后台登录频控不可用，已拒绝本次登录: ${this.msg(err)}`);
      throw new ServiceUnavailableException('登录服务暂时不可用，请稍后重试');
    }
  }

  private async bumpCounter(key: string): Promise<void> {
    try {
      await this.redis.incr(key);
      await this.redis.expire(key, WINDOW_SEC);
    } catch (err) {
      this.logger.warn(`后台登录失败计数写入失败（已忽略）: ${this.msg(err)}`);
    }
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
