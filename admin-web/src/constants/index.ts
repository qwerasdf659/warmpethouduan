/** 后台 JWT 存储 key（localStorage）。 */
export const TOKEN_KEY = 'warmpet_admin_token';

/**
 * 前端挂载的子路径（后端 API 占用 /admin，前端让到 /console）。
 *
 * `.umirc.ts` 的 base/publicPath 与运行时判断当前路由都要用它，所以放在这里
 * 做唯一真相源。Umi 的 `history.location.pathname` 是浏览器原始路径、**带着**
 * 这个前缀，而 react-router 的 `useLocation()` 已经剥掉了 —— 拿路径跟菜单表里
 * 的 path 比较时必须用剥掉的那份。
 */
export const ROUTE_BASE = '/console';

/** 把 `history.location.pathname` 上的 base 前缀剥掉，供 React 之外的代码比较路由。 */
export function stripBase(pathname: string): string {
  if (pathname === ROUTE_BASE) return '/';
  return pathname.startsWith(`${ROUTE_BASE}/`)
    ? pathname.slice(ROUTE_BASE.length)
    : pathname;
}
