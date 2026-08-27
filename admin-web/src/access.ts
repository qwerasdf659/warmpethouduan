import type { AdminProfile } from '@/types';

/**
 * 访问控制工厂（Umi access 插件）。以后端返回的 permissions/roles 为准。
 * super_admin 全放行。路由 access 字段与按钮级 <Access> 都用这里的 key。
 */
export default function access(
  initialState: { profile?: AdminProfile } | undefined,
) {
  const perms = new Set(initialState?.profile?.permissions ?? []);
  const isSuper = (initialState?.profile?.roles ?? []).includes('super_admin');
  const has = (p: string) => isSuper || perms.has(p);

  return {
    canReadPlayer: has('player:read'),
    canWritePlayer: has('player:write'),
    canWritePet: has('pet:write'),
    canGrantItem: has('item:grant'),
    canReadAdmin: has('admin:read'),
    canWriteAdmin: has('admin:write'),
    canReadRole: has('role:read'),
    canWriteRole: has('role:write'),
    canReadPermission: has('permission:read'),
    canWritePermission: has('permission:write'),
    canReadMenu: has('menu:read'),
    canWriteMenu: has('menu:write'),
    canReadAudit: has('audit:read'),
    canReadWallet: has('wallet:read'),
    canWriteWallet: has('wallet:write'),
    canReadExchange: has('exchange:read'),
    canWriteExchange: has('exchange:write'),
    // 兑换码单独授权：印码等于凭空造积分，不该并进 wallet:write
    canReadPromo: has('promo:read'),
    canWritePromo: has('promo:write'),
    // 市场与 wallet:* 分开：看行情、查纠纷挂单是日常客服工作，发币是资金操作。
    // 强制撤单会动到玩家已锁定的资产，因此单列写权限
    canReadMarket: has('market:read'),
    canWriteMarket: has('market:write'),
    canReadStats: has('stats:read'),
    canReadConfig: has('config:read'),
    canWriteConfig: has('config:write'),
    // 玩法扩展：繁殖 / PvP / 诊所 / 小游戏为只读运营视图，活动配置可写
    canReadPet: has('pet:read'),
    canReadPvp: has('pvp:read'),
    canReadClinic: has('clinic:read'),
    canReadMinigame: has('minigame:read'),
    canReadEvent: has('event:read'),
    canWriteEvent: has('event:write'),
  };
}
