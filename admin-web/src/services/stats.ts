import { request } from '@umijs/max';
import type { StatsOverview, TrendPoint } from '@/types';

export async function getOverview(): Promise<StatsOverview> {
  return request('/admin/stats/overview', { method: 'GET' });
}

export async function getTrend(days = 7): Promise<{ points: TrendPoint[] }> {
  return request('/admin/stats/trend', { method: 'GET', params: { days } });
}
