import { request } from '@umijs/max';
import type { Role } from '@/types';

export async function listRoles(): Promise<Role[]> {
  return request('/admin/roles', { method: 'GET' });
}

export async function getRole(id: string): Promise<Role> {
  return request(`/admin/roles/${id}`, { method: 'GET' });
}

export async function createRole(data: {
  code: string;
  name: string;
  description?: string;
}): Promise<Role> {
  return request('/admin/roles', { method: 'POST', data });
}

export async function updateRole(
  id: string,
  data: { name?: string; description?: string },
): Promise<Role> {
  return request(`/admin/roles/${id}`, { method: 'PATCH', data });
}

export async function deleteRole(id: string): Promise<void> {
  return request(`/admin/roles/${id}`, { method: 'DELETE' });
}

export async function setRolePermissions(
  id: string,
  permissionIds: string[],
): Promise<Role> {
  return request(`/admin/roles/${id}/permissions`, {
    method: 'PUT',
    data: { permissionIds },
  });
}
