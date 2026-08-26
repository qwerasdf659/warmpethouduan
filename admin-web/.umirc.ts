import { defineConfig } from '@umijs/max';

/**
 * Umi Max 配置（Ant Design Pro v6）。
 * 关键：前端挂在 /console 子路径（后端 API 占用 /admin 与 /auth/admin），避免路由冲突。
 * 生产：max build 产物由 NestJS ServeStatic 挂在 /console；API 同源调用 /admin、/auth。
 * 开发：max dev 独立端口，proxy 把 /admin、/auth 转发到后端 8080（免跨域）。
 */
export default defineConfig({
  base: '/console/',
  publicPath: '/console/',
  history: { type: 'browser' },
  hash: true,
  npmClient: 'pnpm',
  // 修复多 async chunk 下 esbuild 压缩 helper 命名冲突（Umi 官方建议）
  esbuildMinifyIIFE: true,

  antd: {},
  access: {},
  model: {},
  initialState: {},
  request: {},
  layout: {
    title: 'WarmPet 运营后台',
  },

  routes: [
    { path: '/login', layout: false, component: './Login' },
    { path: '/', redirect: '/dashboard' },
    {
      path: '/dashboard',
      name: '数据看板',
      icon: 'DashboardOutlined',
      access: 'canReadStats',
      component: './Dashboard',
    },
    {
      path: '/welcome',
      name: '概览',
      icon: 'SmileOutlined',
      component: './Welcome',
    },
    {
      path: '/players',
      name: '玩家管理',
      icon: 'TeamOutlined',
      access: 'canReadPlayer',
      component: './Player',
    },
    {
      path: '/economy',
      name: '经济中心',
      icon: 'WalletOutlined',
      routes: [
        { path: '/economy', redirect: '/economy/ledger' },
        {
          path: '/economy/ledger',
          name: '钱包流水',
          access: 'canReadWallet',
          component: './Economy/Ledger',
        },
        {
          path: '/economy/exchange',
          name: '兑换管理',
          access: 'canReadExchange',
          component: './Economy/Exchange',
        },
      ],
    },
    {
      path: '/marketing',
      name: '营销中心',
      icon: 'GiftOutlined',
      routes: [
        { path: '/marketing', redirect: '/marketing/promo' },
        {
          path: '/marketing/promo',
          name: '兑换码',
          access: 'canReadPromo',
          component: './Marketing/Promo',
        },
      ],
    },
    {
      path: '/config',
      name: '配置管理',
      icon: 'ToolOutlined',
      routes: [
        { path: '/config', redirect: '/config/items' },
        {
          path: '/config/items',
          name: '物品管理',
          access: 'canReadConfig',
          component: './Config/Items',
        },
        {
          path: '/config/kv',
          name: '配置中心',
          access: 'canReadConfig',
          component: './Config/Kv',
        },
      ],
    },
    {
      path: '/system',
      name: '系统管理',
      icon: 'SettingOutlined',
      routes: [
        { path: '/system', redirect: '/system/admin-users' },
        {
          path: '/system/admin-users',
          name: '管理员',
          access: 'canReadAdmin',
          component: './System/AdminUser',
        },
        {
          path: '/system/roles',
          name: '角色',
          access: 'canReadRole',
          component: './System/Role',
        },
        {
          path: '/system/permissions',
          name: '权限',
          access: 'canReadPermission',
          component: './System/Permission',
        },
        {
          path: '/system/menus',
          name: '菜单',
          access: 'canReadMenu',
          component: './System/Menu',
        },
        {
          path: '/system/audit-logs',
          name: '审计日志',
          access: 'canReadAudit',
          component: './System/AuditLog',
        },
        {
          path: '/system/idempotency',
          name: '幂等记录',
          access: 'canReadPlayer',
          component: './System/Idempotency',
        },
      ],
    },
  ],

  proxy: {
    '/admin': { target: 'http://localhost:8080', changeOrigin: true },
    '/auth': { target: 'http://localhost:8080', changeOrigin: true },
  },
});
