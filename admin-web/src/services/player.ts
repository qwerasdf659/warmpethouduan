import { request } from '@umijs/max';
import type { Paged, PetStateView, PlayerDetail, PlayerView } from '@/types';
import { newBizId } from '@/utils/bizId';

export async function listPlayers(params: {
  page: number;
  pageSize: number;
  keyword?: string;
}): Promise<Paged<PlayerView>> {
  return request('/admin/players', { method: 'GET', params });
}

export async function getPlayerDetail(id: string): Promise<PlayerDetail> {
  return request(`/admin/players/${id}`, { method: 'GET' });
}

export async function banPlayer(
  id: string,
  reason?: string,
): Promise<{ player: PlayerView }> {
  return request(`/admin/players/${id}/ban`, {
    method: 'POST',
    data: { bizId: newBizId(), reason },
  });
}

export async function unbanPlayer(id: string): Promise<{ player: PlayerView }> {
  return request(`/admin/players/${id}/unban`, {
    method: 'POST',
    data: { bizId: newBizId() },
  });
}

export interface AdjustPetPayload {
  petId?: string;
  mode: 'set' | 'delta';
  reason?: string;
  hunger?: number;
  mood?: number;
  cleanliness?: number;
  stamina?: number;
  intimacy?: number;
  exp?: number;
}

export async function adjustPet(
  id: string,
  payload: AdjustPetPayload,
): Promise<{ pet: PetStateView }> {
  return request(`/admin/players/${id}/pet/adjust`, {
    method: 'POST',
    data: { bizId: newBizId(), ...payload },
  });
}

/**
 * 补发装扮/家具/背景。
 *
 * ⚠ 幂等只到后端的 24h 请求窗口（物品发放没有 ledger 那样的持久唯一键），
 * 所以 UI 上要给明确的成功反馈，别让运营因为不确定而重复点。
 */
export async function grantItem(
  id: string,
  payload: { itemKey: string; qty?: number; reason?: string },
): Promise<{ itemKey: string; qty: number; granted: number }> {
  return request(`/admin/players/${id}/items/grant`, {
    method: 'POST',
    data: { bizId: newBizId(), ...payload },
  });
}

/** 可补发物品目录（走 item:grant 权限，客服无需 config:read）。 */
export async function listGrantableItems(): Promise<{
  list: { key: string; name: string; type: string; slot: string | null }[];
}> {
  return request('/admin/items/grantable', { method: 'GET' });
}
