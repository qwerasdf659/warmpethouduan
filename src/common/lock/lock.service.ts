import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';

const RELEASE_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 玩家级分布式锁（Redis SET NX PX + 唯一 token 释放）。
 * 用于串行化同一玩家的敏感写操作，杜绝并发刷收益。
 */
@Injectable()
export class LockService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private key(name: string): string {
    return `lock:${name}`;
  }

  async acquire(name: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    const ok = await this.redis.set(this.key(name), token, 'PX', ttlMs, 'NX');
    return ok === 'OK' ? token : null;
  }

  async release(name: string, token: string): Promise<void> {
    await this.redis.eval(RELEASE_LUA, 1, this.key(name), token);
  }

  /**
   * 带自动获取/释放的临界区执行。获取不到锁会短暂重试，
   * 超过重试上限抛 409（同一玩家仍有操作在进行）。
   */
  async withLock<T>(
    name: string,
    fn: () => Promise<T>,
    opts?: { ttlMs?: number; retries?: number; retryDelayMs?: number },
  ): Promise<T> {
    const ttlMs = opts?.ttlMs ?? 5000;
    const retries = opts?.retries ?? 20;
    const retryDelayMs = opts?.retryDelayMs ?? 100;

    let token: string | null = null;
    for (let i = 0; i <= retries; i++) {
      token = await this.acquire(name, ttlMs);
      if (token) break;
      await sleep(retryDelayMs);
    }
    if (!token) {
      throw new ConflictException('操作太频繁，请稍后再试');
    }

    try {
      return await fn();
    } finally {
      await this.release(name, token);
    }
  }
}
