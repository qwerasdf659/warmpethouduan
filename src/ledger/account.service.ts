import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { rowsOf } from '../common/db/query-result';
import type { SystemCode } from '../entities/account.entity';
import { AccountRef, isSystemRef } from './ledger.types';

/** 系统账户全集。只有两个，理由见 `Account` 实体注释。 */
export const SYSTEM_ACCOUNTS: { code: SystemCode; note: string }[] = [
  { code: 'FEE', note: '手续费归集（成交税进此账户即退出流通，是通胀 sink）' },
  { code: 'ESCROW', note: '挂单托管（挂单期间标的的持有者）' },
];

/**
 * 账户解析与懒建。
 *
 * 玩家账户**按需创建**而不是注册时创建：注册流程不该因为账本表写入失败而失败，
 * 且大量从不产生任何流水的僵尸账号没有建账户的必要。
 */
@Injectable()
export class AccountService {
  /** userId / systemCode -> accountId。账户 id 一经创建永不变，可安全长期缓存。 */
  private readonly cache = new Map<string, string>();

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** 确保两个系统账户存在（应用启动时调用一次）。 */
  async ensureSystemAccounts(m?: EntityManager): Promise<void> {
    const em = m ?? this.ds.manager;
    for (const { code } of SYSTEM_ACCOUNTS) {
      await em.query(
        `INSERT INTO "account" ("kind","system_code") VALUES ('system',$1)
         ON CONFLICT ("system_code") WHERE "system_code" IS NOT NULL DO NOTHING`,
        [code],
      );
    }
  }

  /**
   * 解析账户 id，不存在则建。
   *
   * 传入 `m` 时在调用方事务内执行 —— 记账必须如此：账户与分录要么一起成功，
   * 要么一起回滚，否则幂等冲突回滚后会留下一个没有任何流水的孤儿账户。
   */
  async resolve(ref: AccountRef, m?: EntityManager): Promise<string> {
    const key = isSystemRef(ref) ? `s:${ref.systemCode}` : `u:${ref.userId}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const em = m ?? this.ds.manager;
    const id = isSystemRef(ref)
      ? await this.resolveSystem(em, ref.systemCode)
      : await this.resolveUser(em, ref.userId);

    // 只缓存已提交的解析结果。在事务内解析时不缓存：该事务可能回滚，
    // 缓存下来的 id 就指向一个不存在的账户，且进程生命周期内不会自愈。
    if (!m) this.cache.set(key, id);
    return id;
  }

  /** 批量解析（凭证有多条腿时省往返）。 */
  async resolveMany(
    refs: AccountRef[],
    m?: EntityManager,
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const ref of refs) {
      const key = isSystemRef(ref) ? `s:${ref.systemCode}` : `u:${ref.userId}`;
      if (!out.has(key)) out.set(key, await this.resolve(ref, m));
    }
    return out;
  }

  /** 反查：accountId -> userId（后台流水展示要按玩家聚合）。 */
  async userIdOf(accountId: string): Promise<string | null> {
    const rows = rowsOf<{ user_id: string | null }>(
      await this.ds.query(`SELECT "user_id" FROM "account" WHERE "id" = $1`, [
        accountId,
      ]),
    );
    return rows[0]?.user_id ?? null;
  }

  /** 已存在则返回 id，否则 null（读路径不建账户，避免读接口产生写）。 */
  async peek(ref: AccountRef): Promise<string | null> {
    const key = isSystemRef(ref) ? `s:${ref.systemCode}` : `u:${ref.userId}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const rows = isSystemRef(ref)
      ? rowsOf<{ id: string }>(
          await this.ds.query(
            `SELECT "id" FROM "account" WHERE "system_code" = $1`,
            [ref.systemCode],
          ),
        )
      : rowsOf<{ id: string }>(
          await this.ds.query(
            `SELECT "id" FROM "account" WHERE "user_id" = $1`,
            [ref.userId],
          ),
        );
    const id = rows[0]?.id ? String(rows[0].id) : null;
    if (id) this.cache.set(key, id);
    return id;
  }

  // ---------------------------------------------------------------- 内部

  private async resolveUser(
    em: EntityManager,
    userId: string,
  ): Promise<string> {
    // ON CONFLICT DO NOTHING 后 RETURNING 不返回行（冲突时无行可返），
    // 所以插入与回读分两步，而不是指望一条语句同时覆盖两种情形
    await em.query(
      `INSERT INTO "account" ("kind","user_id") VALUES ('user',$1)
       ON CONFLICT ("user_id") WHERE "user_id" IS NOT NULL DO NOTHING`,
      [userId],
    );
    const rows = rowsOf<{ id: string }>(
      await em.query(`SELECT "id" FROM "account" WHERE "user_id" = $1`, [
        userId,
      ]),
    );
    if (!rows[0]) throw new InternalServerErrorException('账户创建失败');
    return String(rows[0].id);
  }

  private async resolveSystem(
    em: EntityManager,
    code: SystemCode,
  ): Promise<string> {
    await em.query(
      `INSERT INTO "account" ("kind","system_code") VALUES ('system',$1)
       ON CONFLICT ("system_code") WHERE "system_code" IS NOT NULL DO NOTHING`,
      [code],
    );
    const rows = rowsOf<{ id: string }>(
      await em.query(`SELECT "id" FROM "account" WHERE "system_code" = $1`, [
        code,
      ]),
    );
    if (!rows[0]) {
      throw new InternalServerErrorException(`系统账户 ${code} 创建失败`);
    }
    return String(rows[0].id);
  }
}
