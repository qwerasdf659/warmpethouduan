import { LogoutOutlined } from '@ant-design/icons';
import type { RequestConfig, RunTimeLayoutConfig } from '@umijs/max';
import { history } from '@umijs/max';
import { Dropdown, message } from 'antd';
import { TOKEN_KEY } from '@/constants';
import { getProfile } from '@/services/auth';
import type { AdminProfile } from '@/types';

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

/** ProLayout 运行时配置：标题、用户头像下拉退出、未登录跳转。 */
export const layout: RunTimeLayoutConfig = ({ initialState }) => {
  const profile = initialState?.profile;
  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    message.success('已退出登录');
    history.push('/login');
  };

  return {
    title: 'WarmPet 运营后台',
    logo: false,
    menu: { locale: false },
    avatarProps: {
      title: profile?.displayName || profile?.username || '未登录',
      size: 'small',
      render: (_props: unknown, dom: React.ReactNode) => (
        <Dropdown
          menu={{
            items: [
              {
                key: 'logout',
                icon: <LogoutOutlined />,
                label: '退出登录',
                onClick: logout,
              },
            ],
          }}
        >
          {dom}
        </Dropdown>
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
