import {
  AppstoreOutlined,
  DashboardOutlined,
  GiftOutlined,
  SettingOutlined,
  TeamOutlined,
  ToolOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import type { MenuDataItem } from '@ant-design/pro-components';
import type { AdminProfileMenu } from '@/types';
import { buildMenuTree, type MenuTreeNode } from './menu-tree';

export { isPathAllowed } from './menu-tree';

/**
 * 图标名 → 组件。只登记后台实际在用的几个，而不是 `import * as Icons`——
 * 后者会把整套 antd 图标打进包里，为六个图标付几百 KB 不划算。
 *
 * 运营在菜单页填了这里没有的名字时退化成通用图标，菜单本身照常显示，
 * 不会因为一个图标名把侧边栏搞崩。
 */
const ICONS: Record<string, React.ReactNode> = {
  DashboardOutlined: <DashboardOutlined />,
  TeamOutlined: <TeamOutlined />,
  WalletOutlined: <WalletOutlined />,
  GiftOutlined: <GiftOutlined />,
  ToolOutlined: <ToolOutlined />,
  SettingOutlined: <SettingOutlined />,
};

function toMenuData(nodes: MenuTreeNode[]): MenuDataItem[] {
  return nodes.map((n) => ({
    path: n.path,
    name: n.name,
    icon: n.icon ? (ICONS[n.icon] ?? <AppstoreOutlined />) : undefined,
    children: n.children ? toMenuData(n.children) : undefined,
  }));
}

/** 后端下发的扁平菜单行 → ProLayout 菜单树（结构见 menu-tree.ts）。 */
export function buildMenuData(rows: AdminProfileMenu[]): MenuDataItem[] {
  return toMenuData(buildMenuTree(rows));
}
