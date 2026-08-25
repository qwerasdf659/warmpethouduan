import { request } from '@umijs/max';
import type { MenuNode } from '@/types';

export interface MenuPayload {
  parentId?: string | null;
  name: string;
  type: 'catalog' | 'menu' | 'button';
  path?: string;
  component?: string;
  icon?: string;
  permissionCode?: string;
  sortOrder?: number;
  visible?: boolean;
}

export async function listMenus(): Promise<MenuNode[]> {
  return request('/admin/menus', { method: 'GET' });
}

export async function createMenu(data: MenuPayload): Promise<MenuNode> {
  return request('/admin/menus', { method: 'POST', data });
}

export async function updateMenu(
  id: string,
  data: Partial<MenuPayload>,
): Promise<MenuNode> {
  return request(`/admin/menus/${id}`, { method: 'PATCH', data });
}

export async function deleteMenu(id: string): Promise<void> {
  return request(`/admin/menus/${id}`, { method: 'DELETE' });
}
