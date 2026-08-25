import { request } from '@umijs/max';
import type { AdminUserView, Paged } from '@/types';

export async function listAdminUsers(params: {
  page: number;
  pageSize: number;
}): Promise<Paged<AdminUserView>> {
  return request('/admin/admin-users', { method: 'GET', params });
}

export async function createAdminUser(data: {
  username: string;
  password: string;
  displayName?: string;
  roleIds?: string[];
}): Promise<AdminUserView> {
  return request('/admin/admin-users', { method: 'POST', data });
}

export async function updateAdminUser(
  id: string,
  data: { displayName?: string; status?: 'active' | 'disabled' },
): Promise<AdminUserView> {
  return request(`/admin/admin-users/${id}`, { method: 'PATCH', data });
}

export async function setAdminUserRoles(
  id: string,
  roleIds: string[],
): Promise<AdminUserView> {
  return request(`/admin/admin-users/${id}/roles`, {
    method: 'PUT',
    data: { roleIds },
  });
}

export async function resetAdminUserPassword(
  id: string,
  newPassword: string,
): Promise<void> {
  return request(`/admin/admin-users/${id}/password`, {
    method: 'PUT',
    data: { newPassword },
  });
}

export async function deleteAdminUser(id: string): Promise<void> {
  return request(`/admin/admin-users/${id}`, { method: 'DELETE' });
}
