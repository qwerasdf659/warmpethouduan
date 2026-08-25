import { request } from '@umijs/max';
import type { Paged, RedeemOrderView } from '@/types';

export async function listOrders(params: {
  page: number;
  pageSize: number;
  status?: 'pending' | 'shipped' | 'cancelled';
  userId?: string;
}): Promise<Paged<RedeemOrderView>> {
  return request('/admin/exchange/orders', { method: 'GET', params });
}

export async function shipOrder(
  id: string,
  data: { trackingNo?: string; remark?: string },
): Promise<{ order: RedeemOrderView }> {
  return request(`/admin/exchange/orders/${id}/ship`, {
    method: 'POST',
    data,
  });
}

export async function cancelOrder(
  id: string,
  data: { reason?: string },
): Promise<{ order: RedeemOrderView }> {
  return request(`/admin/exchange/orders/${id}/cancel`, {
    method: 'POST',
    data,
  });
}
