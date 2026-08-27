import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BUSINESS_TZ } from '../common/time/business-day';
import { LedgerService } from '../ledger/ledger.service';

/**
 * 限时活动生命周期（P12）：活动结束后**自动下架限定物品**。
 *
 * 「下架」= `asset_def.enabled = false`（不是删除——已发出的限定款仍有效，停产而非销毁，
 * 这正是稀缺性成立的前提）。限定物品在活动 payload 里声明，支持三种形状：
 * `payload.items[].assetCode` / `payload.shop[].assetCode` / `payload.assetCodes[]`。
 *
 * 放 05:25，避开 04:00–04:30 对账窗口与 05:00 的 PvP 赛季结算。幂等：已下架的不再处理。
 */
@Injectable()
export class EventLifecycleService {
  private readonly logger = new Logger('EventLifecycle');

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly ledger: LedgerService,
  ) {}

  @Cron('25 5 * * *', {
    name: 'event-limited-delist',
    timeZone: BUSINESS_TZ,
  })
  async delistEndedLimited(): Promise<void> {
    interface EventPayload {
      items?: { assetCode?: string }[];
      shop?: { assetCode?: string }[];
      assetCodes?: string[];
    }
    const rows = await this.ds.query<{ payload: EventPayload | null }[]>(
      `SELECT payload FROM game_event WHERE ends_at <= now()`,
    );
    const codes = new Set<string>();
    for (const r of rows) {
      const p: EventPayload = r.payload ?? {};
      const items = Array.isArray(p.items) ? p.items : [];
      const shop = Array.isArray(p.shop) ? p.shop : [];
      for (const it of [...items, ...shop]) {
        if (it?.assetCode) codes.add(it.assetCode);
      }
      const list = Array.isArray(p.assetCodes) ? p.assetCodes : [];
      for (const cc of list) if (typeof cc === 'string') codes.add(cc);
    }
    if (codes.size === 0) return;

    await this.ds.query(
      `UPDATE asset_def SET enabled = false, updated_at = now()
        WHERE code = ANY($1::varchar[]) AND enabled = true`,
      [[...codes]],
    );
    // 刷新资产目录缓存，让下架即时生效（否则要等缓存 TTL）
    this.ledger.invalidateDefCache();
    this.logger.log(`活动结束下架限定物品检查：${codes.size} 项候选`);
  }
}
