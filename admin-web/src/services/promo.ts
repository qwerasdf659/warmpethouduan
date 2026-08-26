import { request } from '@umijs/max';
import type {
  Paged,
  PromoBatchSummary,
  PromoCodeView,
  PromoRedemptionView,
} from '@/types';
import { newBizId } from '@/utils/bizId';

/**
 * 兑换码。这是**营销积分唯一的玩家侧入账路径**——线下物料印码、异业合作发券
 * 都从这里出。写操作走 `promo:write` 权限（印码等于凭空造积分，与钱包发放分开授权）。
 */

export async function listBatches(): Promise<{ list: PromoBatchSummary[] }> {
  return request('/admin/promo/batches', { method: 'GET' });
}

export async function listCodes(params: {
  page: number;
  pageSize: number;
  batch?: string;
  code?: string;
  enabled?: boolean;
}): Promise<Paged<PromoCodeView>> {
  return request('/admin/promo/codes', { method: 'GET', params });
}

export async function listRedemptions(params: {
  page: number;
  pageSize: number;
  userId?: string;
  batch?: string;
}): Promise<Paged<PromoRedemptionView>> {
  return request('/admin/promo/redemptions', { method: 'GET', params });
}

/** 批量生码。返回的 `codes` 是明文全量，供运营导出去印物料。 */
export async function createBatch(data: {
  batch: string;
  pool: 'game' | 'marketing';
  amount: number;
  count: number;
  maxUses?: number;
  expiresAt?: string;
  remark?: string;
}): Promise<{ batch: string; created: number; codes: string[] }> {
  return request('/admin/promo/batches', {
    method: 'POST',
    data: { bizId: newBizId(), ...data },
  });
}

export async function toggleCode(
  id: string,
  enabled: boolean,
): Promise<{ id: string; enabled: boolean }> {
  return request(`/admin/promo/codes/${id}/toggle`, {
    method: 'POST',
    data: { bizId: newBizId(), enabled },
  });
}

export async function toggleBatch(
  batch: string,
  enabled: boolean,
): Promise<{ batch: string; enabled: boolean; affected: number }> {
  return request(`/admin/promo/batches/${encodeURIComponent(batch)}/toggle`, {
    method: 'POST',
    data: { bizId: newBizId(), enabled },
  });
}
