import { describe, expect, it } from 'vitest';
import type { AdminProfileMenu } from '@/types';
import { buildMenuTree, isPathAllowed } from './menu-tree';

/**
 * 这两条逻辑管着「侧边栏显示什么」和「直接敲 URL 能不能进」。
 * 下面的用例不是照着实现补的，是把真实数据上抓到的两个缺陷钉死：
 * 空目录残留、以及 catalog 按前缀放行导致的越权。改坏了必须在这里红。
 */

let nextId = 1;
function menu(over: Partial<AdminProfileMenu>): AdminProfileMenu {
  return {
    id: String(nextId++),
    parentId: null,
    name: '未命名',
    type: 'menu',
    path: null,
    component: null,
    icon: null,
    permissionCode: null,
    sortOrder: 0,
    visible: true,
    ...over,
  };
}

/**
 * 还原线上真实结构：「系统管理」是 permission_code 为 NULL 的 catalog，
 * sortOrder 100 排在子项（10~60）之后——后端就是这么发的，不是构造出来的极端值。
 */
function systemCatalog(childCount: number): AdminProfileMenu[] {
  const catalog = menu({
    id: 'sys',
    name: '系统管理',
    type: 'catalog',
    path: '/system',
    sortOrder: 100,
  });
  const children = Array.from({ length: childCount }, (_, i) =>
    menu({
      id: `sys-${i}`,
      parentId: 'sys',
      name: `子项${i}`,
      path: `/system/child${i}`,
      permissionCode: 'role:read',
      sortOrder: 10 * (i + 1),
    }),
  );
  return [catalog, ...children];
}

describe('buildMenuTree', () => {
  it('子项全被权限过滤掉时，父目录一并剪掉', () => {
    // 后端只发 catalog、不发任何子项 —— 权限不足的账号拿到的就是这个形状。
    // 不剪的话侧边栏里挂着一个「系统管理」，点开是空的。
    const tree = buildMenuTree(systemCatalog(0));
    expect(tree).toEqual([]);
  });

  it('尚有一个子项可见时，父目录保留', () => {
    const tree = buildMenuTree(systemCatalog(1));
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('系统管理');
    expect(tree[0].children).toHaveLength(1);
  });

  it('sortOrder 是全局扁平编号，父节点排在子节点之后也能正确挂载', () => {
    const tree = buildMenuTree(systemCatalog(2));
    expect(tree[0].children?.map((c) => c.name)).toEqual(['子项0', '子项1']);
  });

  it('叶子节点不带空 children，避免被渲染成可展开的空目录', () => {
    const tree = buildMenuTree([menu({ name: '工作台', path: '/dashboard' })]);
    expect(tree[0].children).toBeUndefined();
  });

  it('button 类型与 visible=false 都不进菜单树', () => {
    const tree = buildMenuTree([
      menu({ name: '按钮', type: 'button', path: '/hidden-btn' }),
      menu({ name: '隐藏页', path: '/hidden', visible: false }),
      menu({ name: '工作台', path: '/dashboard' }),
    ]);
    expect(tree.map((n) => n.name)).toEqual(['工作台']);
  });

  it('父节点被过滤掉时子节点提升为顶级，整条分支不会凭空消失', () => {
    const orphan = menu({
      parentId: 'not-in-list',
      name: '孤儿页',
      path: '/orphan',
    });
    expect(buildMenuTree([orphan]).map((n) => n.name)).toEqual(['孤儿页']);
  });
});

describe('isPathAllowed', () => {
  it('目录存活时也不能靠它前缀放行未授权的兄弟页', () => {
    // 这条钉的是真实越权：/system 这个 catalog 的 permissionCode 是 NULL、对谁都放行，
    // 一旦对它按前缀匹配，就等于把整个 /system/* 子树对所有人打开。
    // 目录必须留一个可见子项才活得下来，否则会被剪枝提前干掉、测不到前缀这一段。
    const rows = systemCatalog(1);
    expect(isPathAllowed(rows, '/system/child0')).toBe(true);
    expect(isPathAllowed(rows, '/system/child9')).toBe(false);
  });

  it('目录下无任何可见子页时，连目录本身都不可达', () => {
    const rows = systemCatalog(0);
    expect(isPathAllowed(rows, '/system')).toBe(false);
    expect(isPathAllowed(rows, '/system/roles')).toBe(false);
  });

  it('catalog 自身只认全等（命中后由路由表重定向到首个子页）', () => {
    const rows = systemCatalog(1);
    expect(isPathAllowed(rows, '/system')).toBe(true);
  });

  it('叶子按前缀放行，详情页这类子路由要能进', () => {
    const rows = [menu({ name: '玩家管理', path: '/players' })];
    expect(isPathAllowed(rows, '/players')).toBe(true);
    expect(isPathAllowed(rows, '/players/123')).toBe(true);
  });

  it('前缀放行只认路径分隔符，不能靠拼字符串蒙混过去', () => {
    const rows = [menu({ name: '玩家管理', path: '/players' })];
    expect(isPathAllowed(rows, '/players-secret')).toBe(false);
  });

  it('菜单为空时一律不放行', () => {
    expect(isPathAllowed([], '/players')).toBe(false);
  });
});
