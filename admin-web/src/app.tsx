import type { RequestConfig, RunTimeLayoutConfig } from '@umijs/max';
import { history } from '@umijs/max';
import { Button, message, Result } from 'antd';
import AvatarDropdown from '@/components/AvatarDropdown';
import { TOKEN_KEY } from '@/constants';
import { getProfile } from '@/services/auth';
import type { AdminProfile } from '@/types';
import { buildMenuData, isPathAllowed } from '@/utils/menu';

interface InitialState {
  profile?: AdminProfile;
  fetchProfile: () => Promise<AdminProfile | undefined>;
}

/** 应用启动：有 token 则拉取管理员档案（角色/权限/菜单）供 access 与 layout 使用。 */
export async function getInitialState(): Promise<InitialState> {
  const fetchProfile = async (): Promise<AdminProfile | undefined> => {
    try {
      return await getProfile();
    } catch {
      return undefined;
    }
  };

  if (history.location.pathname !== '/login') {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      const profile = await fetchProfile();
      return { profile, fetchProfile };
    }
  }
  return { fetchProfile };
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
  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    message.success('已退出登录');
    history.push('/login');
  };

  return {
    title: 'WarmPet 运营后台',
    logo: false,
    menu: { locale: false },
    menuDataRender: () => buildMenuData(menus),
    // 侧边栏藏起来不等于进不去：直接敲 URL 仍会渲染页面（虽然接口会 403）。
    // 这里按同一份菜单数据兜一道，避免「看得到半个页面」的困惑。
    childrenRender: (children: React.ReactNode) => {
      const path = history.location.pathname;
      if (!profile || isPathAllowed(menus, path)) return children;
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
    },
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
      if (!token && history.location.pathname !== '/login') {
        history.push('/login');
      }
    },
  };
};

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
        if (history.location.pathname !== '/login') history.push('/login');
        return;
      }
      message.error(msg);
    },
  },
};
