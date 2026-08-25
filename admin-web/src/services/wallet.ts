import { request } from '@umijs/max';
import type { LedgerEntry, Paged, WalletView } from '@/types';

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

function newBizId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
