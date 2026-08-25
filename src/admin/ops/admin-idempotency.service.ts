import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';

const PENDING = '__PENDING__';
const SCAN_MAX = 500;

export interface IdempotencyRecord {
  key: string;
  userId: string;
  bizId: string;
  status: 'pending' | 'done';
  ttlSec: number;
  result: unknown | null;
}

/**
 * 幂等记录查询（只读）。幂等落在 Redis：key = idem:{userId}:{bizId}，
 * 值为 '__PENDING__'（处理中）或上次成功结果的 JSON。仅供后台排查用。
 */
@Injectable()
export class AdminIdempotencyService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private parse(
    key: string,
    raw: string | null,
    ttl: number,
  ): IdempotencyRecord {
    // key 形如 idem:{userId}:{bizId}，userId/bizId 本身不含冒号约束由业务保证
    const parts = key.split(':');
    const userId = parts[1] ?? '';
    const bizId = parts.slice(2).join(':');
    const pending = raw === PENDING || raw === null;
    let result: unknown = null;
    if (!pending && raw) {
      try {
        result = JSON.parse(raw);
      } catch {
        result = raw;
      }
    }
    return {
      key,
      userId,
      bizId,
      status: pending ? 'pending' : 'done',
      ttlSec: ttl,
      result,
    };
  }

  /** 查单条幂等记录。 */
  async getOne(
    userId: string,
    bizId: string,
  ): Promise<IdempotencyRecord | null> {
    const key = `idem:${userId}:${bizId}`;
    const raw = await this.redis.get(key);
    if (raw === null) return null;
    const ttl = await this.redis.ttl(key);
    return this.parse(key, raw, ttl);
  }

  /** 扫描某玩家的全部幂等记录（SCAN，非阻塞；上限 SCAN_MAX 防止刷爆）。 */
  async scanByUser(userId: string): Promise<IdempotencyRecord[]> {
    const match = `idem:${userId}:*`;
    const out: IdempotencyRecord[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        match,
        'COUNT',
        100,
      );
      cursor = next;
      for (const key of keys) {
        if (out.length >= SCAN_MAX) {
          cursor = '0';
          break;
        }
        const raw = await this.redis.get(key);
        const ttl = await this.redis.ttl(key);
        out.push(this.parse(key, raw, ttl));
      }
    } while (cursor !== '0');
    return out;
  }
}
