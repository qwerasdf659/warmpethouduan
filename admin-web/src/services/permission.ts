import { request } from '@umijs/max';
import type { Permission } from '@/types';

export async function listPermissions(): Promise<Permission[]> {
  return request('/admin/permissions', { method: 'GET' });
}

export async function createPermission(data: {
  code: string;
  name: string;
  group?: string;
}): Promise<Permission> {
  return request('/admin/permissions', { method: 'POST', data });
}

export async function deletePermission(id: string): Promise<void> {
  return request(`/admin/permissions/${id}`, { method: 'DELETE' });
}
