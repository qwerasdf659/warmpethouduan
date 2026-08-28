import { theme as antdTheme } from 'antd';
import type { ConfigProviderProps } from 'antd/es/config-provider';
import type { AdminThemeSetting } from '@/types';

/**
 * 前端侧的默认主题，必须与后端 `ADMIN_THEME_DEFAULT` 保持一致。
 *
 * 存在两份是有意的：`/admin/ui/theme` 挂掉时后台不能跟着白屏或变成裸样式，
 * 得有一份不依赖网络的兜底。两边不一致的后果只是接口异常时观感回到这份值，
 * 不会出错。
 */
export const DEFAULT_THEME: AdminThemeSetting = {
  colorPrimary: '#D97706',
  colorSuccess: '#16A34A',
  colorWarning: '#CA8A04',
  colorError: '#DC2626',
  colorBgLayout: '#FAFAF9',
  borderRadius: 8,
  siderTheme: 'dark',
  compact: false,
};

/** 外观设置页的一键预设。运营仍可在预设基础上用取色器微调。 */
export const THEME_PRESETS: { name: string; theme: AdminThemeSetting }[] = [
  { name: '暖琥珀', theme: DEFAULT_THEME },
  {
    name: '沉稳靛蓝',
    theme: {
      ...DEFAULT_THEME,
      colorPrimary: '#4F46E5',
      colorWarning: '#D97706',
      colorBgLayout: '#F8FAFC',
    },
  },
  {
    name: '松墨绿',
    theme: {
      ...DEFAULT_THEME,
      colorPrimary: '#047857',
      colorWarning: '#D97706',
      colorBgLayout: '#F8FAF9',
    },
  },
  {
    name: '经典蓝',
    theme: {
      ...DEFAULT_THEME,
      colorPrimary: '#1677FF',
      colorSuccess: '#52C41A',
      colorWarning: '#FAAD14',
      colorError: '#FF4D4F',
      colorBgLayout: '#F5F5F5',
      borderRadius: 6,
      siderTheme: 'light',
    },
  },
];

/**
 * 主题设置 → ConfigProvider 属性。
 *
 * `compact` 只能走 algorithm，而 Umi 的 antd 插件明确禁止把 algorithm 写进
 * .umirc.ts 的静态配置（会 assert 失败），所以这层转换必须发生在运行时。
 */
export function toAntdConfig(t: AdminThemeSetting): ConfigProviderProps {
  return {
    theme: {
      algorithm: t.compact
        ? [antdTheme.defaultAlgorithm, antdTheme.compactAlgorithm]
        : antdTheme.defaultAlgorithm,
      token: {
        colorPrimary: t.colorPrimary,
        // antd 的 colorInfo 是独立种子（默认与 colorPrimary 同为蓝），只改主色的话
        // Progress 的进度条、processing 标签、info 提示会固执地留在蓝色，跟换过色的
        // 界面撞在一起。跟随主色，与 antd 自身「两者默认相等」的约定一致。
        colorInfo: t.colorPrimary,
        colorSuccess: t.colorSuccess,
        colorWarning: t.colorWarning,
        colorError: t.colorError,
        colorBgLayout: t.colorBgLayout,
        borderRadius: t.borderRadius,
      },
    },
  };
}

/**
 * 主题设置 → ProLayout 的 token。
 *
 * 深色侧边栏走 sider token 而不是 ProLayout 的 `navTheme='realDark'`：后者是
 * 整站深色（连内容区的卡片和表格一起变黑），并不是「深色侧边栏」。
 * 浅色时返回空对象，交回 ProLayout 自己的默认值。
 */
export function toProLayoutToken(t: AdminThemeSetting) {
  if (t.siderTheme !== 'dark') return { bgLayout: t.colorBgLayout };

  return {
    bgLayout: t.colorBgLayout,
    sider: {
      colorMenuBackground: '#1C1917',
      colorMenuItemDivider: 'rgba(255, 255, 255, 0.08)',
      colorTextMenu: 'rgba(255, 255, 255, 0.72)',
      colorTextMenuSecondary: 'rgba(255, 255, 255, 0.5)',
      colorTextMenuTitle: '#FFFFFF',
      colorTextMenuSelected: '#FFFFFF',
      colorTextMenuActive: '#FFFFFF',
      colorTextItemHover: '#FFFFFF',
      colorTextMenuItemHover: '#FFFFFF',
      colorTextSubMenuSelected: '#FFFFFF',
      colorBgMenuItemSelected: t.colorPrimary,
      colorBgMenuItemHover: 'rgba(255, 255, 255, 0.08)',
      colorBgMenuItemActive: 'rgba(255, 255, 255, 0.12)',
      colorBgMenuItemCollapsedElevated: '#292524',
      colorBgCollapsedButton: '#292524',
      colorTextCollapsedButton: 'rgba(255, 255, 255, 0.65)',
      colorTextCollapsedButtonHover: '#FFFFFF',
    },
  };
}

/**
 * 首帧用的主题。
 *
 * Umi 的 antd 运行时配置是个同步函数，拿不到 `getInitialState` 的异步结果，
 * 而 ConfigProvider 的初值只在首次渲染读一次。所以启动时先把拉到的主题存进
 * 这个模块级变量，运行时配置再同步读走 —— 否则会先渲染出默认配色，等
 * setState 生效后再闪一下变成运营配的颜色。
 */
let bootTheme: AdminThemeSetting = DEFAULT_THEME;

export function setBootTheme(t: AdminThemeSetting) {
  bootTheme = t;
}

export function getBootTheme(): AdminThemeSetting {
  return bootTheme;
}
