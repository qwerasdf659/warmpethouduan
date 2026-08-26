import type { AdminProfileMenu } from '@/types';

/** 装树时只关心结构，图标交给 menu.tsx 渲染，这里保持无 JSX、无运行时依赖。 */
export interface MenuTreeNode {
  path?: string;
  name: string;
  icon: string | null;
  /** catalog 节点自身不是页面，只能被精确命中后重定向到子页，不能按前缀放行整个子树。 */
  isCatalog: boolean;
  children?: MenuTreeNode[];
}

interface Built {
  path?: string;
  name: string;
  icon: string | null;
  isCatalog: boolean;
  children: Built[];
}

/**
 * 装树 + 剪枝，`buildMenuTree` 与 `isPathAllowed` 共用，保证「看得见」与「进得去」
 * 是同一套口径。两套口径分开写过一版，结果是：只有 wallet:read 的账号侧边栏里没有
 * 「系统管理」的任何子项，但直接敲 /system/roles 却能进——因为放行判断按 /system
 * 前缀匹配，而 /system 这个 catalog 的 permission_code 是 NULL、对谁都放行。
 */
function buildPruned(rows: AdminProfileMenu[]): Built[] {
  const visible = rows
    .filter((m) => m.visible && m.type !== 'button')
    .sort((a, b) => a.sortOrder - b.sortOrder || Number(a.id) - Number(b.id));

  const nodes = new Map<string, Built>();
  for (const m of visible) {
    nodes.set(m.id, {
      path: m.path ?? undefined,
      name: m.name,
      icon: m.icon,
      isCatalog: m.type === 'catalog',
      children: [],
    });
  }

  // sortOrder 是**全局扁平**的，不是同级内编号（真实数据里「系统管理」是 100，
  // 子项却是 10~60）。先全量建节点、再按已排序顺序挂载：同级相对次序即正确，
  // 父节点排在子节点之后也无妨。
  const roots: Built[] = [];
  for (const m of visible) {
    const node = nodes.get(m.id);
    if (!node) continue;
    const parent = m.parentId ? nodes.get(m.parentId) : undefined;
    // 父节点被权限过滤掉时子节点提升为顶级，免得整条分支凭空消失
    (parent?.children ?? roots).push(node);
  }

  // 目录的 permission_code 为 NULL（对谁都放行），子项却是按权限过滤过的，
  // 所以权限不足时会剩下一堆点开是空的目录。这里把它们剪掉。
  const prune = (items: Built[]): Built[] =>
    items
      .map((i) => ({ ...i, children: prune(i.children) }))
      .filter((i) => !i.isCatalog || i.children.length > 0);

  return prune(roots);
}

export function buildMenuTree(rows: AdminProfileMenu[]): MenuTreeNode[] {
  const toNode = (b: Built): MenuTreeNode => ({
    path: b.path,
    name: b.name,
    icon: b.icon,
    isCatalog: b.isCatalog,
    // 叶子留着空数组会被 ProLayout 渲染成可展开的空目录
    children: b.children.length ? b.children.map(toNode) : undefined,
  });
  return buildPruned(rows).map(toNode);
}

/**
 * 当前路径是否可达，用于直接敲 URL 时的兜底拦截。
 *
 * 叶子按前缀放行（详情页这类子路由 `/players/123` 要能进）；catalog 只认全等
 * （它自身没有页面，命中后由路由表重定向到第一个子页，那一跳会再走一次本判断）。
 */
export function isPathAllowed(
  rows: AdminProfileMenu[],
  pathname: string,
): boolean {
  const hit = (nodes: MenuTreeNode[]): boolean =>
    nodes.some((n) => {
      if (n.children?.length && hit(n.children)) return true;
      if (!n.path) return false;
      return n.isCatalog
        ? pathname === n.path
        : pathname === n.path || pathname.startsWith(`${n.path}/`);
    });
  return hit(buildMenuTree(rows));
}
