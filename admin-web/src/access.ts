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
    canReadStats: has('stats:read'),
    canReadConfig: has('config:read'),
    canWriteConfig: has('config:write'),
  };
}
