import { request } from '@umijs/max';
import type { GameEventProgressView, GameEventView, Paged } from '@/types';

/**
 * 运营活动配置。四类活动（扭蛋池 / 商店 / 任务 / 登录）共用一张 events 表，
 * 差异全部落在 payload（JSON）里。写操作走 `event:write` 权限。
 */

export async function listEvents(params: {
  page: number;
  pageSize: number;
}): Promise<Paged<GameEventView>> {
  return request('/admin/events', { method: 'GET', params });
}

export async function createEvent(data: {
  key: string;
  name: string;
  type: GameEventView['type'];
  startsAt: string;
  endsAt: string;
  banner?: string;
  payload?: Record<string, unknown>;
  enabled?: boolean;
}): Promise<{ event: GameEventView }> {
  return request('/admin/events', { method: 'POST', data });
}

export async function updateEvent(
  key: string,
  data: Partial<{
    name: string;
    type: GameEventView['type'];
    startsAt: string;
    endsAt: string;
    banner: string;
    payload: Record<string, unknown>;
    enabled: boolean;
  }>,
): Promise<{ event: GameEventView }> {
  return request(`/admin/events/${encodeURIComponent(key)}`, {
    method: 'PATCH',
    data,
  });
}

export async function removeEvent(key: string): Promise<{ ok: true }> {
  return request(`/admin/events/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  });
}

/** 某个活动下的玩家参与进度。 */
export async function listEventProgress(
  key: string,
  params: { page: number; pageSize: number },
): Promise<Paged<GameEventProgressView>> {
  return request(`/admin/events/${encodeURIComponent(key)}/progress`, {
    method: 'GET',
    params,
  });
}
