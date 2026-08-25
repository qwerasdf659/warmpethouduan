/**
 * 后台初始化种子数据（权限点 / 基础菜单）。集中在此便于统一维护。
 * 新增业务权限时在 SEED_PERMISSIONS 追加，重启即幂等同步（不删除已存在项）。
 */

export interface SeedPermission {
  code: string;
  name: string;
  group: string;
}

export const SEED_PERMISSIONS: SeedPermission[] = [
  { code: 'admin:read', name: '查看管理员', group: '系统' },
  { code: 'admin:write', name: '管理管理员', group: '系统' },
  { code: 'role:read', name: '查看角色', group: '系统' },
  { code: 'role:write', name: '管理角色', group: '系统' },
  { code: 'permission:read', name: '查看权限', group: '系统' },
  { code: 'permission:write', name: '管理权限', group: '系统' },
  { code: 'menu:read', name: '查看菜单', group: '系统' },
  { code: 'menu:write', name: '管理菜单', group: '系统' },
  { code: 'audit:read', name: '查看审计日志', group: '系统' },
  { code: 'player:read', name: '查看玩家', group: '运营' },
  { code: 'player:write', name: '操作玩家（补偿/封禁）', group: '运营' },
  { code: 'pet:read', name: '查看宠物', group: '运营' },
  { code: 'pet:write', name: '调整宠物', group: '运营' },
  { code: 'wallet:read', name: '查看钱包/流水', group: '经济' },
  { code: 'wallet:write', name: '人工发币/扣币', group: '经济' },
  { code: 'exchange:read', name: '查看兑换订单', group: '经济' },
  { code: 'exchange:write', name: '处理兑换履约', group: '经济' },
  { code: 'stats:read', name: '查看数据统计', group: '运营' },
  { code: 'config:read', name: '查看配置', group: '配置' },
  { code: 'config:write', name: '修改配置', group: '配置' },
];

export interface SeedMenu {
  key: string;
  parentKey: string | null;
  name: string;
  type: 'catalog' | 'menu' | 'button';
  path: string | null;
  component: string | null;
  icon: string | null;
  permissionCode: string | null;
  sortOrder: number;
}

/** 基础菜单树（幂等按 path 补种；新增页面在此追加即可）。 */
export const SEED_MENUS: SeedMenu[] = [
  {
    key: 'dashboard',
    parentKey: null,
    name: '数据看板',
    type: 'menu',
    path: '/dashboard',
    component: './Dashboard',
    icon: 'DashboardOutlined',
    permissionCode: 'stats:read',
    sortOrder: 1,
  },
  {
    key: 'players',
    parentKey: null,
    name: '玩家管理',
    type: 'menu',
    path: '/players',
    component: './Player',
    icon: 'TeamOutlined',
    permissionCode: 'player:read',
    sortOrder: 10,
  },
  {
    key: 'economy',
    parentKey: null,
    name: '经济中心',
    type: 'catalog',
    path: '/economy',
    component: null,
    icon: 'WalletOutlined',
    permissionCode: null,
    sortOrder: 20,
  },
  {
    key: 'economy.ledger',
    parentKey: 'economy',
    name: '钱包流水',
    type: 'menu',
    path: '/economy/ledger',
    component: './Economy/Ledger',
    icon: null,
    permissionCode: 'wallet:read',
    sortOrder: 21,
  },
  {
    key: 'economy.exchange',
    parentKey: 'economy',
    name: '兑换管理',
    type: 'menu',
    path: '/economy/exchange',
    component: './Economy/Exchange',
    icon: null,
    permissionCode: 'exchange:read',
    sortOrder: 22,
  },
  {
    key: 'config',
    parentKey: null,
    name: '配置管理',
    type: 'catalog',
    path: '/config',
    component: null,
    icon: 'ToolOutlined',
    permissionCode: null,
    sortOrder: 30,
  },
  {
    key: 'config.items',
    parentKey: 'config',
    name: '物品管理',
    type: 'menu',
    path: '/config/items',
    component: './Config/Items',
    icon: null,
    permissionCode: 'config:read',
    sortOrder: 31,
  },
  {
    key: 'config.kv',
    parentKey: 'config',
    name: '配置中心',
    type: 'menu',
    path: '/config/kv',
    component: './Config/Kv',
    icon: null,
    permissionCode: 'config:read',
    sortOrder: 32,
  },
  {
    key: 'system',
    parentKey: null,
    name: '系统管理',
    type: 'catalog',
    path: '/system',
    component: null,
    icon: 'SettingOutlined',
    permissionCode: null,
    sortOrder: 100,
  },
  {
    key: 'system.admin',
    parentKey: 'system',
    name: '管理员',
    type: 'menu',
    path: '/system/admin-users',
    component: './System/AdminUser',
    icon: null,
    permissionCode: 'admin:read',
    sortOrder: 10,
  },
  {
    key: 'system.role',
    parentKey: 'system',
    name: '角色',
    type: 'menu',
    path: '/system/roles',
    component: './System/Role',
    icon: null,
    permissionCode: 'role:read',
    sortOrder: 20,
  },
  {
    key: 'system.permission',
    parentKey: 'system',
    name: '权限',
    type: 'menu',
    path: '/system/permissions',
    component: './System/Permission',
    icon: null,
    permissionCode: 'permission:read',
    sortOrder: 30,
  },
  {
    key: 'system.menu',
    parentKey: 'system',
    name: '菜单',
    type: 'menu',
    path: '/system/menus',
    component: './System/Menu',
    icon: null,
    permissionCode: 'menu:read',
    sortOrder: 40,
  },
  {
    key: 'system.audit',
    parentKey: 'system',
    name: '审计日志',
    type: 'menu',
    path: '/system/audit-logs',
    component: './System/AuditLog',
    icon: null,
    permissionCode: 'audit:read',
    sortOrder: 50,
  },
];
