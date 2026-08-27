import { request } from '@umijs/max';
import type { AdminThemeSetting, AdminThemeView } from '@/types';

/** 读主题。后端未鉴权，登录页也能调。 */
export async function getTheme(): Promise<AdminThemeView> {
  return request('/admin/ui/theme', { method: 'GET' });
}

export async function updateTheme(
  theme: AdminThemeSetting,
): Promise<AdminThemeView> {
  return request('/admin/ui/theme', { method: 'PUT', data: { theme } });
}

export async function resetTheme(): Promise<AdminThemeView> {
  return request('/admin/ui/theme/reset', { method: 'POST' });
}
