import { randomBytes } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { ClockService } from '../common/clock/clock.service';
import {
  businessDayKey,
  secondsUntilNextBusinessDay,
} from '../common/time/business-day';
import { GameConfigService } from '../config/game-config.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { AdScene } from './boost.config';

export interface AdTokenIssued {
  nonce: string;
  scene: AdScene;
  expiresInSec: number;
  /** 今日该 scene 还可再领几次 */
  remaining: number;
}

/**
 * 广告一次性凭证（nonce）的签发与核销。
 *
 * 「看广告换增值」的接口（赛跑奖励翻倍 / 复活重跑）不接受客户端裸调用：
 * 必须先 `issue()` 领一枚绑定 scene 的短时效 nonce，播完广告后带着它来核销。
 * 核销用 Lua 做「读 + 校验 scene + 删」的原子操作——分两条命令的话，
 * 并发双发会同时读到同一枚有效 nonce，等于凭证失去意义。
 */
@Injectable()
export class AdTokenService {
  /** 返回 1=核销成功；0=不存在/已过期/已用掉；-1=scene 不匹配（不消耗凭证）。 */
  private static readonly CONSUME_LUA = `
local v = redis.call('GET', KEYS[1])
if not v then return 0 end
if v ~= ARGV[1] then return -1 end
redis.call('DEL', KEYS[1])
return 1
`;

  /**
   * 原子签发：读日计数 → 判断上限 → 自增计数并续 TTL → 写 nonce，全在一次 eval 内完成。
   * 返回自增后的计数 n（≥1）；-1 = 已达上限，此时不写任何键。
   *
   * 为什么必须原子：分成 `GET` 判断 + `INCR` 两条命令时，并发签发会同时读到同一个 used、
   * 同时通过上限校验、各拿一枚有效 nonce，导致超发——可无限放大赛跑翻倍/复活次数。
   * 与 `consume()` 用 Lua 防双花同理，签发侧同样要原子。
   *
   * KEYS[1]=capKey KEYS[2]=nonceKey；ARGV[1]=每日上限 [2]=scene [3]=nonce TTL秒 [4]=capKey TTL秒。
   */
  private static readonly ISSUE_LUA = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
if used >= tonumber(ARGV[1]) then return -1 end
local n = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))
redis.call('SET', KEYS[2], ARGV[2], 'EX', tonumber(ARGV[3]))
return n
`;

  constructor(
    private readonly clock: ClockService,
    private readonly config: GameConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** 签发一枚 scene 绑定的一次性凭证（受账号级每日上限约束）。 */
  async issue(userId: string, scene: AdScene): Promise<AdTokenIssued> {
    const cfg = await this.config.get('boost.ad_token');
    const now = this.clock.now();
    const day = businessDayKey(now);
    const capKey = `adtoken:cap:${userId}:${day}:${scene}`;
    const nonce = randomBytes(16).toString('hex');

    const n = (await this.redis.eval(
      AdTokenService.ISSUE_LUA,
      2,
      capKey,
      this.keyOf(userId, nonce),
      String(cfg.dailyCapPerScene),
      scene,
      String(cfg.ttlSec),
      String(secondsUntilNextBusinessDay(now)),
    )) as number;

    if (n === -1) {
      throw new BadRequestException('今日该场景的广告次数已用尽');
    }

    return {
      nonce,
      scene,
      expiresInSec: cfg.ttlSec,
      remaining: Math.max(0, cfg.dailyCapPerScene - n),
    };
  }

  /** 核销凭证；无效/过期/场景不符一律 400。核销后该 nonce 立即失效。 */
  async consume(userId: string, nonce: string, scene: AdScene): Promise<void> {
    const res = (await this.redis.eval(
      AdTokenService.CONSUME_LUA,
      1,
      this.keyOf(userId, nonce),
      scene,
    )) as number;

    if (res === 1) return;
    throw new BadRequestException(
      res === -1 ? '广告凭证与当前场景不匹配' : '广告凭证无效或已过期',
    );
  }

  private keyOf(userId: string, nonce: string): string {
    return `adtoken:${userId}:${nonce}`;
  }
}
