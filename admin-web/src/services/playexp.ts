import { request } from '@umijs/max';
import type {
  ClinicCaseView,
  ClinicView,
  EggView,
  MinigameSessionView,
  Paged,
  PvpMatchView,
  PvpRankView,
} from '@/types';

/**
 * 玩法扩展的只读运营视图：繁殖、PvP 天梯、诊所、小游戏。
 * 均只提供分页查询，写入由游戏侧负责。读权限各自独立（pet/pvp/clinic/minigame:read）。
 */

// -------- 繁殖（breed）--------

export async function listBreedEggs(params: {
  page: number;
  pageSize: number;
}): Promise<Paged<EggView>> {
  return request('/admin/breed/eggs', { method: 'GET', params });
}

// -------- PvP --------

export async function listPvpRank(params: {
  page: number;
  pageSize: number;
}): Promise<Paged<PvpRankView>> {
  return request('/admin/pvp/rank', { method: 'GET', params });
}

export async function listPvpMatches(params: {
  page: number;
  pageSize: number;
}): Promise<Paged<PvpMatchView>> {
  return request('/admin/pvp/matches', { method: 'GET', params });
}

// -------- 诊所（clinic）--------

export async function listClinic(params: {
  page: number;
  pageSize: number;
}): Promise<Paged<ClinicView>> {
  return request('/admin/clinic', { method: 'GET', params });
}

export async function listClinicCases(params: {
  page: number;
  pageSize: number;
}): Promise<Paged<ClinicCaseView>> {
  return request('/admin/clinic/cases', { method: 'GET', params });
}

// -------- 小游戏（minigame）--------

export async function listMinigameSessions(params: {
  page: number;
  pageSize: number;
}): Promise<Paged<MinigameSessionView>> {
  return request('/admin/minigame/sessions', { method: 'GET', params });
}
