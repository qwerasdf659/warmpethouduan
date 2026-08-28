import { defineConfig } from '@umijs/max';
import { ROUTE_BASE } from './src/constants';

/**
 * Umi Max 配置（Ant Design Pro v6）。
 * 关键：前端挂在 /console 子路径（后端 API 占用 /admin），避免路由冲突。
 * 生产：max build 产物由 NestJS ServeStatic 挂在 /console；API 同源调用 /admin。
 * 开发：max dev 独立端口，proxy 把 /admin 转发到后端 8080（免跨域）。
 */
export default defineConfig({
  // 与运行时剥前缀用的是同一个常量：两边写死各一份的话，改子路径时
  // 只改一处就会让菜单权限判断整片失效（且表现为「所有页面 403」）。
  base: `${ROUTE_BASE}/`,
  publicPath: `${ROUTE_BASE}/`,
  history: { type: 'browser' },
  hash: true,
  npmClient: 'pnpm',
  // 修复多 async chunk 下 esbuild 压缩 helper 命名冲突（Umi 官方建议）
  esbuildMinifyIIFE: true,

  // configProvider 必须显式开启：Umi 的 antd 插件只有看到这个键才会生成
  // ConfigProvider 包裹层和 useAntdConfig/useAntdConfigSetter 两个钩子，
  // 而「运营随时改配色」正是靠 setter 在运行时换 token 实现的。
  // 这里的 token 只是首帧兜底与默认值，真正生效的一份来自 /admin/ui/theme。
  // 注意：algorithm 不能写在静态配置里（插件会 assert），紧凑模式走运行时。
  antd: {
    configProvider: {},
    theme: {
      token: {
        colorPrimary: '#D97706',
        colorInfo: '#D97706',
        colorSuccess: '#16A34A',
        colorWarning: '#CA8A04',
        colorError: '#DC2626',
        colorBgLayout: '#FAFAF9',
        borderRadius: 8,
      },
    },
  },
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
    { path: '/economy/lots', component: './Economy/Lots' },
    { path: '/market', redirect: '/market/listings' },
    { path: '/market/listings', component: './Market/Listings' },
    { path: '/market/net-flow', component: './Market/NetFlow' },
    { path: '/market/bids', component: './Market/Bids' },
    { path: '/market/trade', component: './Market/Trade' },
    { path: '/marketing', redirect: '/marketing/promo' },
    { path: '/marketing/promo', component: './Marketing/Promo' },
    { path: '/marketing/events', component: './Marketing/Events' },
    // 目录节点自身没有页面，统一重定向到第一个子页；漏掉的话直接敲
    // /console/pet 会渲染空白（其余五个目录都有这一行，此前只有 pet 缺）
    { path: '/pet', redirect: '/pet/eggs' },
    { path: '/pet/eggs', component: './Pet/Eggs' },
    { path: '/pet/pvp', component: './Pet/Pvp' },
    { path: '/pet/clinic', component: './Pet/Clinic' },
    { path: '/pet/minigame', component: './Pet/Minigame' },
    { path: '/pet/race', component: './Pet/Race' },
    { path: '/pet/gacha', component: './Pet/Gacha' },
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
    { path: '/system/theme', component: './System/Theme' },
  ],

  proxy: {
    '/admin': { target: 'http://localhost:8080', changeOrigin: true },
  },
});
