import { defineConfig } from '@umijs/max';

/**
 * Umi Max 配置（Ant Design Pro v6）。
 * 关键：前端挂在 /console 子路径（后端 API 占用 /admin），避免路由冲突。
 * 生产：max build 产物由 NestJS ServeStatic 挂在 /console；API 同源调用 /admin。
 * 开发：max dev 独立端口，proxy 把 /admin 转发到后端 8080（免跨域）。
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

  // 这里只声明「路径 → 组件」——这是构建期必须静态可见的部分（组件要被打包与分包）。
  // 菜单的名称、图标、层级、排序、可见性一律来自数据库 admin_menu，运行时由
  // app.tsx 的 menuDataRender 渲染。此前两边各存一份，运营在菜单页改名毫无效果。
  routes: [
    { path: '/login', layout: false, component: './Login' },
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', component: './Dashboard' },
    { path: '/players', component: './Player' },
    { path: '/economy', redirect: '/economy/ledger' },
    { path: '/economy/ledger', component: './Economy/Ledger' },
    { path: '/economy/exchange', component: './Economy/Exchange' },
    { path: '/economy/issuance', component: './Economy/Issuance' },
    { path: '/market', redirect: '/market/listings' },
    { path: '/market/listings', component: './Market/Listings' },
    { path: '/market/net-flow', component: './Market/NetFlow' },
    { path: '/marketing', redirect: '/marketing/promo' },
    { path: '/marketing/promo', component: './Marketing/Promo' },
    { path: '/config', redirect: '/config/items' },
    { path: '/config/items', component: './Config/Items' },
    { path: '/config/kv', component: './Config/Kv' },
    { path: '/system', redirect: '/system/admin-users' },
    { path: '/system/admin-users', component: './System/AdminUser' },
    { path: '/system/roles', component: './System/Role' },
    { path: '/system/permissions', component: './System/Permission' },
    { path: '/system/menus', component: './System/Menu' },
    { path: '/system/audit-logs', component: './System/AuditLog' },
    { path: '/system/idempotency', component: './System/Idempotency' },
  ],

  proxy: {
    '/admin': { target: 'http://localhost:8080', changeOrigin: true },
  },
});
