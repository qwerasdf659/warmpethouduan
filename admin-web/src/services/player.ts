import { request } from '@umijs/max';
import type { Paged, PetStateView, PlayerDetail, PlayerView } from '@/types';

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

/** 生成本次写操作的幂等 bizId（浏览器原生 UUID）。 */
function newBizId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

export async function unbanPlayer(
  id: string,
): Promise<{ player: PlayerView }> {
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
