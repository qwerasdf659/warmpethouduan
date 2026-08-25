import { request } from '@umijs/max';
import type { GameConfigView, ItemDefView } from '@/types';

// -------- 物品定义（item_def）--------

export async function listItems(type?: string): Promise<{ list: ItemDefView[] }> {
  return request('/admin/items', { method: 'GET', params: type ? { type } : {} });
}

export async function createItem(
  data: Partial<ItemDefView>,
): Promise<{ item: ItemDefView }> {
  return request('/admin/items', { method: 'POST', data });
}

export async function updateItem(
  id: string,
  data: Partial<ItemDefView>,
): Promise<{ item: ItemDefView }> {
  return request(`/admin/items/${id}`, { method: 'PUT', data });
}

export async function deleteItem(id: string): Promise<{ ok: true }> {
  return request(`/admin/items/${id}`, { method: 'DELETE' });
}

// -------- 配置中心（game_config）--------

export async function listConfigs(): Promise<{ list: GameConfigView[] }> {
  return request('/admin/config', { method: 'GET' });
}

export async function upsertConfig(
  key: string,
  data: { value: unknown; description?: string },
): Promise<{ config: GameConfigView }> {
  return request(`/admin/config/${key}`, { method: 'PUT', data });
}

export async function deleteConfig(key: string): Promise<{ ok: true }> {
  return request(`/admin/config/${key}`, { method: 'DELETE' });
}
