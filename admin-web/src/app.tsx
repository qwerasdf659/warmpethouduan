import type { RequestConfig, RunTimeLayoutConfig } from '@umijs/max';
import { history, useLocation } from '@umijs/max';
import { Button, message, Result } from 'antd';
import AvatarDropdown from '@/components/AvatarDropdown';
import { ROUTE_BASE, TOKEN_KEY, stripBase } from '@/constants';
import { getProfile } from '@/services/auth';
import { getTheme } from '@/services/theme';
import type { AdminProfile, AdminThemeSetting } from '@/types';
import { buildMenuData, isPathAllowed } from '@/utils/menu';
import {
  DEFAULT_THEME,
  getBootTheme,
  setBootTheme,
  toAntdConfig,
  toProLayoutToken,
} from '@/utils/theme';

interface InitialState {
  profile?: AdminProfile;
  fetchProfile: () => Promise<AdminProfile | undefined>;
  /** 运营在「外观设置」里配的主题；接口异常时为代码内置默认值 */
  theme: AdminThemeSetting;
}

/**
 * 应用启动：拉管理员档案（角色/权限/菜单）与后台外观主题。
 *
 * 主题读接口不鉴权，所以登录页也一并套用运营配的配色，不会出现「登录页一个
 * 样、进去又一个样」。拉取失败时静默回落默认主题 —— 配色是观感问题，不该
 * 让它挡住登录。
 */
export async function getInitialState(): Promise<InitialState> {
  const fetchProfile = async (): Promise<AdminProfile | undefined> => {
    try {
      return await getProfile();
    } catch {
      return undefined;
    }
  };

  let theme = DEFAULT_THEME;
  try {
    theme = (await getTheme()).theme;
  } catch {
    // 保持默认主题
  }
  // 供 antd 运行时配置同步读取，避免首帧闪一下默认色
  setBootTheme(theme);

  if (stripBase(history.location.pathname) !== '/login') {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      const profile = await fetchProfile();
      return { profile, fetchProfile, theme };
    }
  }
  return { fetchProfile, theme };
}

/**
 * antd 运行时配置：把启动时拉到的主题喂给 ConfigProvider 的初值。
 *
 * 这里只负责首帧。运营在外观设置页保存后的即时生效走 `useAntdConfigSetter()`，
 * 不刷新页面。
 */
export function antd(memo: Record<string, unknown>) {
  return { ...memo, ...toAntdConfig(getBootTheme()) };
}

/**
 * ProLayout 运行时配置：标题、菜单、用户头像下拉退出、未登录跳转。
 *
 * 侧边栏来自 `profile.menus`（后端按权限过滤好的 admin_menu 行），不是 .umirc.ts。
 * 路由表只负责「路径 → 组件」这个构建期映射；菜单叫什么、排第几、归在哪个目录下、
 * 谁看得见，全部以数据库为准 —— 否则运营在菜单页改了名字，界面纹丝不动。
 */
export const layout: RunTimeLayoutConfig = ({ initialState }) => {
  const profile = initialState?.profile;
  const menus = profile?.menus ?? [];
  // ProLayout 的 token 不属于 antd ConfigProvider，换不了，只能从 initialState
  // 走；外观设置页保存后会 setInitialState 触发重渲染。
  const layoutToken = toProLayoutToken(initialState?.theme ?? DEFAULT_THEME);
  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    message.success('已退出登录');
    history.push('/login');
  };

  return {
    title: 'WarmPet 运营后台',
    logo: false,
    // 固定浅色：深色侧边栏靠上面的 sider token 实现。navTheme='realDark' 会把
    // 内容区也一起变黑，不是这里想要的效果。
    navTheme: 'light',
    token: layoutToken,
    menu: { locale: false },
    menuDataRender: () => buildMenuData(menus),
    // 侧边栏藏起来不等于进不去：直接敲 URL 仍会渲染页面（虽然接口会 403）。
    // 这里按同一份菜单数据兜一道，避免「看得到半个页面」的困惑。
    childrenRender: (children: React.ReactNode) => (
      <MenuGuard menus={menus} enabled={!!profile}>
        {children}
      </MenuGuard>
    ),
    avatarProps: {
      title: profile?.displayName || profile?.username || '未登录',
      size: 'small',
      render: (_props: unknown, dom: React.ReactNode) => (
        <AvatarDropdown profile={profile} onLogout={logout}>
          {dom}
        </AvatarDropdown>
      ),
    },
    onPageChange: () => {
      const token = localStorage.getItem(TOKEN_KEY);
      if (!token && stripBase(history.location.pathname) !== '/login') {
        history.push('/login');
      }
    },
  };
};

/**
 * 直接敲 URL 时按菜单兜一道权限。
 *
 * 路径必须取自 `useLocation()` 而不是 `history.location`：后者是浏览器原始
 * 路径，带着 `/console` 前缀，跟 `admin_menu` 里存的 `/dashboard` 永远比不上，
 * 结果是**每个页面都被判成 403**。react-router 的 location 已按 basename 剥好。
 */
function MenuGuard({
  menus,
  enabled,
  children,
}: {
  menus: AdminProfile['menus'];
  enabled: boolean;
  children: React.ReactNode;
}) {
  const { pathname } = useLocation();
  if (!enabled || isPathAllowed(menus, pathname)) return <>{children}</>;
  return (
    <Result
      status="403"
      title="403"
      subTitle="没有访问该页面的权限，如需开通请联系管理员。"
      extra={
        <Button type="primary" onClick={() => history.push('/dashboard')}>
          回到数据看板
        </Button>
      }
    />
  );
}

/** 统一请求：注入 Bearer token；失败按 {code,message} 提示，401 清 token 回登录。 */
export const request: RequestConfig = {
  baseURL: '',
  requestInterceptors: [
    (config: any) => {
      const token = localStorage.getItem(TOKEN_KEY);
      config.headers = config.headers || {};
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    },
  ],
  errorConfig: {
    errorHandler: (error: any) => {
      const resp = error?.response;
      const data = resp?.data;
      const rawMsg = data?.message ?? error?.message ?? '请求失败';
      const msg = Array.isArray(rawMsg) ? rawMsg.join(', ') : rawMsg;

      if (resp?.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        message.error('登录已过期，请重新登录');
        if (stripBase(history.location.pathname) !== '/login') {
          history.push('/login');
        }
        return;
      }
      message.error(msg);
    },
  },
};
