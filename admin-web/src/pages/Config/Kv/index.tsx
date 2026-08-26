import {
  ModalForm,
  PageContainer,
  ProFormText,
  ProFormTextArea,
  ProTable,
} from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { useRef } from 'react';
import { Button, Popconfirm, Tag, Tooltip, Typography, message } from 'antd';
import {
  deleteConfig,
  listConfigs,
  resetConfig,
  upsertConfig,
} from '@/services/config';
import type { GameConfigView } from '@/types';

/** JSON 预览：对象/数组折叠成单行，超长省略。 */
function preview(value: unknown) {
  return (
    <Typography.Text code ellipsis style={{ maxWidth: 320 }}>
      {JSON.stringify(value)}
    </Typography.Text>
  );
}

export default function KvPage() {
  const access = useAccess();
  const tableRef = useRef<ActionType>();
  const canWrite = access.canWriteConfig;

  const submit = async (v: {
    key: string;
    description?: string;
    value: string;
  }) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(v.value);
    } catch {
      message.error('value 必须是合法 JSON');
      return false;
    }
    // 后端 Joi 报错会由全局 errorHandler 弹出具体字段，这里不吞异常
    await upsertConfig(v.key, { value: parsed, description: v.description });
    message.success('已保存，立即生效（无需重启）');
    tableRef.current?.reload();
    return true;
  };

  const columns: ProColumns<GameConfigView>[] = [
    {
      title: 'key',
      dataIndex: 'key',
      width: 220,
      render: (_, r) => (
        <span>
          {r.key}
          {r.registered ? null : (
            <Tooltip title="代码里没有注册这个 key，玩法不会读它。属历史遗留，可以删除">
              <Tag color="default" style={{ marginLeft: 8 }}>
                未注册
              </Tag>
            </Tooltip>
          )}
        </span>
      ),
    },
    { title: '说明', dataIndex: 'description', hideInSearch: true },
    {
      title: '当前值',
      dataIndex: 'value',
      hideInSearch: true,
      render: (_, r) => (
        <span>
          {preview(r.value)}
          {r.modified ? (
            <Tag color="orange" style={{ marginLeft: 8 }}>
              已改
            </Tag>
          ) : null}
        </span>
      ),
    },
    {
      title: '默认值',
      dataIndex: 'default',
      hideInSearch: true,
      render: (_, r) => (r.registered ? preview(r.default) : '-'),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      valueType: 'dateTime',
      width: 180,
      hideInSearch: true,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 180,
      render: (_, record) => {
        if (!canWrite) return '-';
        const actions = [
          <ModalForm
            key="edit"
            title={`编辑配置 · ${record.key}`}
            width={560}
            trigger={<a>编辑</a>}
            modalProps={{ destroyOnClose: true }}
            initialValues={{
              key: record.key,
              description: record.description,
              value: JSON.stringify(record.value, null, 2),
            }}
            onFinish={submit as any}
          >
            <ProFormText name="key" label="key" disabled />
            <ProFormText name="description" label="说明" />
            <ProFormTextArea
              name="value"
              label="value (JSON)"
              fieldProps={{ rows: 10 }}
              rules={[{ required: true }]}
              extra={
                record.registered
                  ? `默认值：${JSON.stringify(record.default)}`
                  : '该 key 未在代码中注册，改了也不会生效'
              }
            />
          </ModalForm>,
        ];

        if (record.registered) {
          // 注册项只能恢复默认，不能删：删掉只会让它从列表消失、运营再也调不到
          actions.push(
            <Popconfirm
              key="reset"
              title="恢复为代码内置默认值？"
              description="立即生效，不需要重启服务"
              disabled={!record.modified}
              onConfirm={async () => {
                await resetConfig(record.key);
                message.success('已恢复默认值');
                tableRef.current?.reload();
              }}
            >
              {record.modified ? (
                <a>恢复默认</a>
              ) : (
                <Typography.Text type="secondary">恢复默认</Typography.Text>
              )}
            </Popconfirm>,
          );
        } else {
          actions.push(
            <Popconfirm
              key="del"
              title="确认删除该配置项？"
              description="仅未注册的历史遗留 key 可删"
              onConfirm={async () => {
                await deleteConfig(record.key);
                message.success('已删除');
                tableRef.current?.reload();
              }}
            >
              <a style={{ color: '#ff4d4f' }}>删除</a>
            </Popconfirm>,
          );
        }
        return actions;
      },
    },
  ];

  return (
    <PageContainer
      header={{ title: '配置中心' }}
      content="改动保存后立即生效，不需要重启服务。「已改」标签表示当前值偏离了代码默认值。"
      extra={
        canWrite
          ? [
              <ModalForm
                key="create"
                title="新增配置"
                width={560}
                trigger={<Button type="primary">新增配置</Button>}
                modalProps={{ destroyOnClose: true }}
                initialValues={{ value: '{}' }}
                onFinish={submit as any}
              >
                <ProFormText
                  name="key"
                  label="key"
                  rules={[{ required: true }]}
                  extra="必须是代码中已注册的 key，否则后端会拒绝并列出可用项"
                />
                <ProFormText name="description" label="说明" />
                <ProFormTextArea
                  name="value"
                  label="value (JSON)"
                  fieldProps={{ rows: 10 }}
                  rules={[{ required: true }]}
                />
              </ModalForm>,
            ]
          : []
      }
    >
      <ProTable<GameConfigView>
        rowKey="key"
        actionRef={tableRef}
        columns={columns}
        search={false}
        pagination={false}
        request={async () => {
          const res = await listConfigs();
          return { data: res.list, total: res.list.length, success: true };
        }}
      />
    </PageContainer>
  );
}
