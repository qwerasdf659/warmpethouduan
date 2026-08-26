import { request } from '@umijs/max';
import type {
  LedgerEntry,
  Paged,
  ReconcileReport,
  WalletView,
} from '@/types';

export async function listLedger(params: {
  page: number;
  pageSize: number;
  userId?: string;
  pool?: 'game' | 'marketing';
  reason?: string;
}): Promise<Paged<LedgerEntry>> {
  return request('/admin/ledger', { method: 'GET', params });
}

export async function getPlayerWallet(
  id: string,
): Promise<{ wallet: WalletView }> {
  return request(`/admin/players/${id}/wallet`, { method: 'GET' });
}

/** 立即对账：校验 wallet == sum(ledger.delta)，只读不写。 */
export async function runReconcile(): Promise<ReconcileReport> {
  return request('/admin/reconcile', { method: 'GET' });
}

function newBizId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  pool: 'game' | 'marketing';
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
    pool: 'game' | 'marketing';
    direction: 'grant' | 'deduct';
    amount: number;
    reason?: string;
  },
): Promise<{ wallet: WalletView }> {
  return request(`/admin/players/${id}/wallet/grant`, {
    method: 'POST',
    data: { bizId: newBizId(), ...payload },
  });
}
