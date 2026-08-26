import { request } from '@umijs/max';
import type { GameConfigView, ItemDefView } from '@/types';

// -------- 资产定义（asset_def）--------
//
// 路径参数是 code 而非自增 id：asset_def 的主键就是 code。

export async function listItems(
  type?: string,
): Promise<{ list: ItemDefView[] }> {
  return request('/admin/items', {
    method: 'GET',
    params: type ? { type } : {},
  });
}

export async function createItem(
  data: Partial<ItemDefView> & { key?: string },
): Promise<{ item: ItemDefView }> {
  return request('/admin/items', { method: 'POST', data });
}

export async function updateItem(
  code: string,
  data: Partial<ItemDefView>,
): Promise<{ item: ItemDefView }> {
  return request(`/admin/items/${code}`, { method: 'PUT', data });
}

export async function deleteItem(code: string): Promise<{ ok: true }> {
  return request(`/admin/items/${code}`, { method: 'DELETE' });
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

export async function getConfig(key: string): Promise<GameConfigView> {
  return request(`/admin/config/${key}`, { method: 'GET' });
}

/** 恢复为代码内置默认值（保留该行，运营仍可继续调）。 */
export async function resetConfig(
  key: string,
): Promise<{ config: GameConfigView }> {
  return request(`/admin/config/${key}/reset`, { method: 'POST' });
}

export async function deleteConfig(key: string): Promise<{ ok: true }> {
  return request(`/admin/config/${key}`, { method: 'DELETE' });
}
