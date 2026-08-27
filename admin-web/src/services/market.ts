import { request } from '@umijs/max';
import type { MarketListing, MarketStatus, NetFlowAlert, Paged } from '@/types';
import { newBizId } from '@/utils/bizId';

/**
 * 市场当前开关与阈值。
 *
 * 值得单独调一次：市场默认全关，关着的时候挂单列表是空的 ——
 * 与「开着但确实没人挂单」在界面上无法区分。
 */
export async function getMarketStatus(): Promise<MarketStatus> {
  return request('/admin/market/status', { method: 'GET' });
}

/** 挂单列表。含已成交/已撤销/已过期 —— 处理纠纷要看的正是这些。 */
export async function listMarketListings(params: {
  page: number;
  pageSize: number;
  status?: string;
  mode?: string;
  assetCode?: string;
  sellerUserId?: string;
}): Promise<Paged<MarketListing>> {
  return request('/admin/market/listings', { method: 'GET', params });
}

/**
 * 强制撤单。退回标的 + 解冻全部活跃出价 + 落终态，与玩家撤单同一份实现。
 */
export async function forceCancelListing(
  id: string,
  payload: { reason: string },
): Promise<{ ok: true; listingId: string }> {
  return request(`/admin/market/listings/${id}/force-cancel`, {
    method: 'POST',
    data: { bizId: newBizId(), ...payload },
  });
}

/**
 * R4 单向净流出清单。
 *
 * 只是**线索**不是证据：「A 长期只送 B」高度可疑，但情侣号、师徒关系也是这个形状。
 */
export async function listNetFlow(params: {
  days?: number;
  threshold?: number;
}): Promise<{ list: NetFlowAlert[]; days: number }> {
  return request('/admin/market/risk/net-flow', { method: 'GET', params });
}
