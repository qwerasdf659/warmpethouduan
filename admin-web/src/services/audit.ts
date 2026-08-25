import { request } from '@umijs/max';
import type { AuditLog, Paged } from '@/types';

export async function listAuditLogs(params: {
  page: number;
  pageSize: number;
  adminUserId?: string;
  success?: 'true' | 'false';
}): Promise<Paged<AuditLog>> {
  return request('/admin/audit-logs', { method: 'GET', params });
}
