import { PageContainer, ProCard } from '@ant-design/pro-components';
import { useAntdConfigSetter } from '@@/plugin-antd';
import { useAccess, useModel } from '@umijs/max';
import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  ColorPicker,
  ConfigProvider,
  Divider,
  Popconfirm,
  Progress,
  Segmented,
  Slider,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { getTheme, resetTheme, updateTheme } from '@/services/theme';
import type { AdminThemeSetting } from '@/types';
import {
  DEFAULT_THEME,
  THEME_PRESETS,
  setBootTheme,
  toAntdConfig,
} from '@/utils/theme';

/** 可调色项。抽出来是因为四个颜色的表单行完全同构，逐个手写只会漏掉一个。 */
const COLOR_FIELDS: {
  key: keyof Pick<
    AdminThemeSetting,
    'colorPrimary' | 'colorSuccess' | 'colorWarning' | 'colorError'
  >;
  label: string;
  hint: string;
}[] = [
  { key: 'colorPrimary', label: '主色', hint: '按钮、链接、选中态、进度条' },
  { key: 'colorSuccess', label: '成功色', hint: '正常状态标签、上升趋势' },
  { key: 'colorWarning', label: '警告色', hint: '待处理提醒、风险提示' },
  { key: 'colorError', label: '危险色', hint: '封禁、删除、下降趋势' },
];

function sameTheme(a: AdminThemeSetting, b: AdminThemeSetting) {
  return (Object.keys(DEFAULT_THEME) as (keyof AdminThemeSetting)[]).every(
    (k) => a[k] === b[k],
  );
}

export default function ThemePage() {
  const access = useAccess();
  const canWrite = access.canWriteConfig;
  const setAntdConfig = useAntdConfigSetter();
  const { initialState, setInitialState } = useModel('@@initialState');

  /** 已落库的一份，用于「放弃改动」和判断有没有未保存内容 */
  const [saved, setSaved] = useState<AdminThemeSetting>(DEFAULT_THEME);
  const [draft, setDraft] = useState<AdminThemeSetting>(DEFAULT_THEME);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;
    getTheme()
      .then((res) => {
        if (!alive) return;
        setSaved(res.theme);
        setDraft(res.theme);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const dirty = !sameTheme(draft, saved);
  const isDefault = sameTheme(saved, DEFAULT_THEME);
  const patch = (p: Partial<AdminThemeSetting>) =>
    setDraft((prev) => ({ ...prev, ...p }));

  /**
   * 保存成功后立刻让整个后台换色，不要求刷新。
   *
   * 三处都要更新：ConfigProvider 管 antd 的 token，initialState 管 ProLayout
   * 的侧边栏明暗，模块级 bootTheme 管下次刷新的首帧。漏掉任何一处，运营都会
   * 看到「保存了但某块没变」。
   */
  const applyGlobally = async (t: AdminThemeSetting) => {
    setAntdConfig(toAntdConfig(t));
    setBootTheme(t);
    await setInitialState((s: any) => ({ ...s, theme: t }));
  };

  const onSave = async () => {
    setSubmitting(true);
    try {
      const res = await updateTheme(draft);
      setSaved(res.theme);
      setDraft(res.theme);
      await applyGlobally(res.theme);
      message.success('已保存，所有管理员下次打开即生效');
    } finally {
      setSubmitting(false);
    }
  };

  const onReset = async () => {
    setSubmitting(true);
    try {
      const res = await resetTheme();
      setSaved(res.theme);
      setDraft(res.theme);
      await applyGlobally(res.theme);
      message.success('已恢复默认外观');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageContainer
      header={{ title: '外观设置' }}
      content="调整后台的配色与密度。左侧改动会实时反映在右侧预览里，点「保存」后对所有管理员生效。"
      loading={loading}
      footer={
        canWrite
          ? [
              <Popconfirm
                key="reset"
                title="恢复为系统默认外观？"
                description="当前配色会被覆盖，该操作会记入审计日志"
                disabled={isDefault && !dirty}
                onConfirm={onReset}
              >
                <Button disabled={(isDefault && !dirty) || submitting}>
                  恢复默认
                </Button>
              </Popconfirm>,
              <Button
                key="discard"
                disabled={!dirty || submitting}
                onClick={() => setDraft(saved)}
              >
                放弃改动
              </Button>,
              <Button
                key="save"
                type="primary"
                disabled={!dirty}
                loading={submitting}
                onClick={onSave}
              >
                保存
              </Button>,
            ]
          : undefined
      }
    >
      {canWrite ? null : (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="你没有「修改配置」权限，本页仅供预览。"
        />
      )}

      <ProCard gutter={16} wrap ghost>
        <ProCard title="配色" colSpan={{ xs: 24, lg: 10 }} bordered>
          <Typography.Text type="secondary">快速预设</Typography.Text>
          <div
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              margin: '8px 0 20px',
            }}
          >
            {THEME_PRESETS.map((p) => (
              <Button
                key={p.name}
                size="small"
                disabled={!canWrite}
                type={sameTheme(draft, p.theme) ? 'primary' : 'default'}
                onClick={() => setDraft(p.theme)}
                icon={
                  <span
                    style={{
                      display: 'inline-block',
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: p.theme.colorPrimary,
                    }}
                  />
                }
              >
                {p.name}
              </Button>
            ))}
          </div>

          {COLOR_FIELDS.map((f) => (
            <div
              key={f.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 16,
              }}
            >
              <div>
                <div>{f.label}</div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {f.hint}
                </Typography.Text>
              </div>
              <ColorPicker
                value={draft[f.key]}
                disabled={!canWrite}
                disabledAlpha
                format="hex"
                showText
                onChange={(c) => patch({ [f.key]: c.toHexString() })}
              />
            </div>
          ))}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
            }}
          >
            <div>
              <div>页面底色</div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                内容区背景，卡片仍为白色
              </Typography.Text>
            </div>
            <ColorPicker
              value={draft.colorBgLayout}
              disabled={!canWrite}
              disabledAlpha
              format="hex"
              showText
              onChange={(c) => patch({ colorBgLayout: c.toHexString() })}
            />
          </div>

          <Divider />

          <div style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 4 }}>圆角 {draft.borderRadius}px</div>
            <Slider
              min={0}
              max={16}
              value={draft.borderRadius}
              disabled={!canWrite}
              onChange={(v) => patch({ borderRadius: v })}
            />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
            }}
          >
            <div>
              <div>侧边栏</div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                只影响左侧导航，内容区始终为浅色
              </Typography.Text>
            </div>
            <Segmented
              value={draft.siderTheme}
              disabled={!canWrite}
              options={[
                { label: '深色', value: 'dark' },
                { label: '浅色', value: 'light' },
              ]}
              onChange={(v) => patch({ siderTheme: v as 'dark' | 'light' })}
            />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div>紧凑模式</div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                收紧行高与控件尺寸，一屏看更多数据
              </Typography.Text>
            </div>
            <Switch
              checked={draft.compact}
              disabled={!canWrite}
              onChange={(v) => patch({ compact: v })}
            />
          </div>
        </ProCard>

        <ProCard
          title="实时预览"
          colSpan={{ xs: 24, lg: 14 }}
          bordered
          extra={
            dirty ? (
              <Tag color="orange">有未保存改动</Tag>
            ) : (
              <Tag>与线上一致</Tag>
            )
          }
        >
          <ThemePreview theme={draft} />
        </ProCard>
      </ProCard>
    </PageContainer>
  );
}

/**
 * 预览区。
 *
 * 用局部 ConfigProvider 而不是直接改全局：拖动取色器时全站跟着变会很晃眼，
 * 而且运营要是把底色调成深色，还没点保存整个后台就已经看不清了 —— 只有点
 * 「保存」才应该改变全局观感。
 */
function ThemePreview({ theme }: { theme: AdminThemeSetting }) {
  const rows = [
    { id: '10248', name: '喵喵爱吃鱼', status: '正常', coin: 3240, mood: 82 },
    { id: '10247', name: '星空漫游者', status: '正常', coin: 15678, mood: 64 },
    { id: '10245', name: '小熊软糖', status: '已封禁', coin: 120, mood: 31 },
  ];

  return (
    <ConfigProvider {...toAntdConfig(theme)}>
      <div
        style={{
          background: theme.colorBgLayout,
          padding: 16,
          borderRadius: theme.borderRadius,
        }}
      >
        <Space wrap style={{ marginBottom: 16 }}>
          <Button type="primary">主要按钮</Button>
          <Button>次要按钮</Button>
          <Button danger>危险操作</Button>
          <Button type="link">文字链接</Button>
        </Space>

        <Space wrap style={{ marginBottom: 16 }}>
          <Tag color="success">正常</Tag>
          <Tag color="warning">待处理</Tag>
          <Tag color="error">已封禁</Tag>
          <Tag color="processing">出战</Tag>
        </Space>

        <div style={{ marginBottom: 16 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            饱食度
          </Typography.Text>
          <Progress percent={82} />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            清洁度
          </Typography.Text>
          <Progress percent={31} status="exception" />
        </div>

        <Table
          size="small"
          pagination={false}
          rowKey="id"
          dataSource={rows}
          columns={[
            { title: '玩家ID', dataIndex: 'id', width: 90 },
            { title: '昵称', dataIndex: 'name' },
            {
              title: '状态',
              dataIndex: 'status',
              width: 90,
              render: (v: string) => (
                <Tag color={v === '正常' ? 'success' : 'error'}>{v}</Tag>
              ),
            },
            {
              title: '游戏币',
              dataIndex: 'coin',
              align: 'right',
              render: (v: number) => v.toLocaleString(),
            },
            {
              title: '操作',
              width: 100,
              render: () => (
                <Space size="small">
                  <a>详情</a>
                  <a>封禁</a>
                </Space>
              ),
            },
          ]}
        />
      </div>
    </ConfigProvider>
  );
}
