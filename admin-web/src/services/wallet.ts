import { request } from '@umijs/max';
import type {
  AssetIssuanceSummary,
  DailyAssetStat,
  LedgerEntry,
  Paged,
  ReconcileReport,
  WalletView,
} from '@/types';
import { newBizId } from '@/utils/bizId';

export async function listLedger(params: {
  page: number;
  pageSize: number;
  userId?: string;
  /** 按资产筛（`asset_def.code`）。留空 = 全部资产 */
  assetCode?: string;
  reason?: string;
}): Promise<Paged<LedgerEntry>> {
  return request('/admin/wallet/ledger', { method: 'GET', params });
}

export async function getPlayerWallet(
  id: string,
): Promise<{ wallet: WalletView }> {
  return request(`/admin/wallet/players/${id}`, { method: 'GET' });
}

/**
 * 发行/销毁日报（通胀监控 + 刷币告警 + 待兑付负债）。
 *
 * 读的是每日对账物化出来的 `asset_daily_stat`，不实时扫分录 ——
 * 发行与销毁是单边不守恒的两个口径，实时求和给不出财务要的那两个数。
 */
export async function listDailyStats(params: {
  days?: number;
  assetCode?: string;
  reason?: string;
}): Promise<{
  list: DailyAssetStat[];
  summary: AssetIssuanceSummary[];
  days: number;
}> {
  return request('/admin/wallet/daily-stats', { method: 'GET', params });
}

/** 立即对账：逐条校验账本 11 项不变量，只读不写。 */
export async function runReconcile(): Promise<ReconcileReport> {
  return request('/admin/wallet/reconcile', { method: 'GET' });
}

/**
 * 冲正一张凭证（争议处理 / 盗号追回）。
 *
 * 这是唯一的账务修复手段：按原凭证生成反向分录，原凭证一字不改。
 * 刻意没有「重算余额」之类的工具 —— 那会忽略冻结与批次分桶，把账改得更错。
 */
export async function reverseTxn(
  txnId: string,
  payload: { reason: string },
): Promise<{ txnId: string; reversedFrom: string }> {
  return request(`/admin/wallet/txns/${txnId}/reverse`, {
    method: 'POST',
    data: { bizId: newBizId(), ...payload },
  });
}

/**
 * 批量发币/扣币。**部分失败仍返回 200**，靠 `failed` 逐条给原因，
 * 运营只补发失败的那几个，不用整批重来。
 *
 * 幂等键按 `bizId:userId` 逐人派生，所以同一 `bizId` 重提是安全的
 * （已成功的不会二次入账）。
 */
export async function grantWalletBulk(payload: {
  userIds: string[];
  assetCode: string;
  direction: 'grant' | 'deduct';
  amount: number;
  reason?: string;
}): Promise<{
  total: number;
  succeeded: number;
  failed: { userId: string; message: string }[];
}> {
  return request('/admin/wallet/grant-bulk', {
    method: 'POST',
    data: { bizId: newBizId(), ...payload },
  });
}

export async function grantWallet(
  id: string,
  payload: {
    assetCode: string;
    direction: 'grant' | 'deduct';
    amount: number;
    reason?: string;
  },
): Promise<{ wallet: WalletView }> {
  return request(`/admin/wallet/players/${id}/grant`, {
    method: 'POST',
    data: { bizId: newBizId(), ...payload },
  });
}
