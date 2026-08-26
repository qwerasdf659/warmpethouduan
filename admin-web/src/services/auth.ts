import { request } from '@umijs/max';
import type { AdminProfile, LoginResult } from '@/types';

export async function login(body: {
  username: string;
  password: string;
}): Promise<LoginResult> {
  return request<LoginResult>('/admin/auth/login', {
    method: 'POST',
    data: body,
  });
}

export async function getProfile(): Promise<AdminProfile> {
  return request<AdminProfile>('/admin/auth/me', { method: 'GET' });
}
