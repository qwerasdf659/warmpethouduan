import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import {
  IDEMPOTENCY_ADMIN_SCOPE,
  IDEMPOTENCY_PENDING as PENDING,
} from '../../common/idempotency/idempotency.keys';
import { REDIS_CLIENT } from '../../redis/redis.module';

const SCAN_MAX = 500;

export interface IdempotencyRecord {
  key: string;
  userId: string;
  bizId: string;
  status: 'pending' | 'done';
  ttlSec: number;
  /** 处理中时为 null；已完成时为上次成功结果的 JSON 反序列化值。 */
  result: unknown;
}

/**
 * 幂等记录查询（只读）。幂等落在 Redis，值为 `IDEMPOTENCY_PENDING`（处理中）
 * 或上次成功结果的 JSON。仅供后台排查用。
 *
 * key 有两种命名空间：玩家 `idem:{userId}:{bizId}`、后台
 * `idem:admin:{adminUserId}:{bizId}`。查后台记录时把 `userId` 传成
 * `admin:{adminUserId}` 即可，两者拼出来的 key 形状一致。
 */
@Injectable()
export class AdminIdempotencyService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private parse(
    key: string,
    raw: string | null,
    ttl: number,
  ): IdempotencyRecord {
    // key 形如 idem:{userId}:{bizId} 或 idem:admin:{adminUserId}:{bizId}，
    // userId/bizId 本身不含冒号的约束由业务保证
    const parts = key.split(':');
    const isAdmin = parts[1] === IDEMPOTENCY_ADMIN_SCOPE;
    const idEnd = isAdmin ? 3 : 2;
    const userId = parts.slice(1, idEnd).join(':');
    const bizId = parts.slice(idEnd).join(':');
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
