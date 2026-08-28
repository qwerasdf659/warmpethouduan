import { request } from '@umijs/max';
import type { CouponVerifyResult, Paged, RedeemOrderView } from '@/types';

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

/**
 * 门店核销满减券。
 *
 * 券在玩家出示核销码那一刻就已从账本销毁，这里只是把一次性凭据兑掉，
 * 因此**不产生任何账务动作**，失败也不需要回滚。同一码二次核销会返回 400。
 */
export async function verifyCoupon(code: string): Promise<CouponVerifyResult> {
  return request('/admin/exchange/coupons/verify', {
    method: 'POST',
    data: { code },
  });
}
