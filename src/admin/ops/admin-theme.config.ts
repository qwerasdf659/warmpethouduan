import * as Joi from 'joi';

/** `admin_setting` 里存放外观主题的 key。 */
export const ADMIN_THEME_KEY = 'ui.theme';

/**
 * 运营可调的后台外观。
 *
 * 刻意不做成「任意 antd token 直传」：那样运营能把 `colorText` 调成白色，
 * 整个后台变成一片空白，而且没有任何人能在界面上把它改回来。这里只开放
 * 一组改不坏布局的旋钮，其余 token 由 antd 从主色推导。
 */
export interface AdminThemeSetting {
  colorPrimary: string;
  colorSuccess: string;
  colorWarning: string;
  colorError: string;
  /** 页面底色（内容区背景，不是卡片背景） */
  colorBgLayout: string;
  borderRadius: number;
  /**
   * 侧边栏明暗。
   *
   * 只作用于侧边栏，内容区始终是浅色。刻意不透出 ProLayout 的 `navTheme`：
   * 它的 `realDark` 是**整站深色**，运营照着「侧边栏」的字面意思一点，
   * 整个后台会连表格带卡片全变黑。
   */
  siderTheme: 'dark' | 'light';
  /** 紧凑模式：表格行高、控件尺寸整体收紧 */
  compact: boolean;
}

/**
 * 代码内置默认值，同时是「恢复默认」的目标和脏数据的兜底。
 * 暖琥珀调，呼应 WarmPet 的品牌调性；运营可在外观设置页随时改。
 */
export const ADMIN_THEME_DEFAULT: AdminThemeSetting = {
  colorPrimary: '#D97706',
  colorSuccess: '#16A34A',
  colorWarning: '#CA8A04',
  colorError: '#DC2626',
  colorBgLayout: '#FAFAF9',
  borderRadius: 8,
  siderTheme: 'dark',
  compact: false,
};

const hexColor = Joi.string()
  .pattern(/^#[0-9a-fA-F]{6}$/)
  .required()
  .messages({
    'string.pattern.base': '颜色必须是 #RRGGBB 形式的六位十六进制值',
  });

/**
 * 全量校验（不接受部分字段）。与玩法配置同一套取舍：运营少填一个字段就
 * 静默走 undefined 是很难查的线上问题，宁可写入时直接报错。
 */
export const ADMIN_THEME_SCHEMA = Joi.object<AdminThemeSetting>({
  colorPrimary: hexColor,
  colorSuccess: hexColor,
  colorWarning: hexColor,
  colorError: hexColor,
  colorBgLayout: hexColor,
  // 上限 16：再大 antd 的紧凑控件（Tag、小号 Button）会被圆角吃掉可读宽度
  borderRadius: Joi.number().integer().min(0).max(16).required(),
  siderTheme: Joi.string().valid('dark', 'light').required(),
  compact: Joi.boolean().required(),
})
  .required()
  .unknown(false);
