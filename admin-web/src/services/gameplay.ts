import { request } from '@umijs/max';
import type {
  AssetLotView,
  GachaDrawView,
  GachaStateView,
  MarketBidView,
  Paged,
  PlayerDossier,
  RaceRecordView,
  TradeOfferView,
} from '@/types';

/**
 * 玩法巡检类只读接口。
 *
 * 这些表此前在后台完全没有入口，客服只能连库查：抽卡保底、易货报价、竞价出价、
 * 赛跑掉单、资产批次过期，都是会直接变成工单的东西。
 */

export async function listGachaDraws(params: {
  page: number;
  pageSize: number;
  userId?: string;
  poolKey?: string;
  filter?: 'rare';
}): Promise<Paged<GachaDrawView>> {
  return request('/admin/gacha/draws', { method: 'GET', params });
}

export async function listGachaStates(params: {
  page: number;
  pageSize: number;
  userId?: string;
  poolKey?: string;
}): Promise<Paged<GachaStateView>> {
  return request('/admin/gacha/states', { method: 'GET', params });
}

export async function listTradeOffers(params: {
  page: number;
  pageSize: number;
  userId?: string;
  status?: string;
}): Promise<Paged<TradeOfferView>> {
  return request('/admin/trade/offers', { method: 'GET', params });
}

export async function listMarketBids(params: {
  page: number;
  pageSize: number;
  listingId?: string;
  userId?: string;
  status?: string;
}): Promise<Paged<MarketBidView>> {
  return request('/admin/market/bids', { method: 'GET', params });
}

export async function listRaceRecords(params: {
  page: number;
  pageSize: number;
  userId?: string;
  status?: 'pending' | 'settled';
  trackKey?: string;
}): Promise<Paged<RaceRecordView>> {
  return request('/admin/race/records', { method: 'GET', params });
}

export async function listAssetLots(params: {
  page: number;
  pageSize: number;
  userId?: string;
  assetCode?: string;
  filter?: 'remaining' | 'expiring';
}): Promise<Paged<AssetLotView>> {
  return request('/admin/wallet/lots', { method: 'GET', params });
}

/** 玩家玩法档案（抽屉的「玩法」与「物品」两个 Tab 共用一次请求）。 */
export async function getPlayerDossier(id: string): Promise<PlayerDossier> {
  return request(`/admin/players/${id}/dossier`, { method: 'GET' });
}
