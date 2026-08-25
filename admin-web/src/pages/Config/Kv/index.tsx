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
import { Button, Popconfirm, Typography, message } from 'antd';
import {
  deleteConfig,
  listConfigs,
  upsertConfig,
} from '@/services/config';
import type { GameConfigView } from '@/types';

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
    await upsertConfig(v.key, { value: parsed, description: v.description });
    message.success('已保存');
    tableRef.current?.reload();
    return true;
  };

  const columns: ProColumns<GameConfigView>[] = [
    { title: 'key', dataIndex: 'key', width: 200 },
    { title: '说明', dataIndex: 'description', hideInSearch: true },
    {
      title: 'value',
      dataIndex: 'value',
      hideInSearch: true,
      render: (_, r) => (
        <Typography.Text code ellipsis style={{ maxWidth: 320 }}>
          {JSON.stringify(r.value)}
        </Typography.Text>
      ),
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
      width: 130,
      render: (_, record) => {
        if (!canWrite) return '-';
        return [
          <ModalForm
            key="edit"
            title={`编辑配置 · ${record.key}`}
            width={520}
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
              fieldProps={{ rows: 8 }}
              rules={[{ required: true }]}
            />
          </ModalForm>,
          <Popconfirm
            key="del"
            title="确认删除该配置项？"
            onConfirm={async () => {
              await deleteConfig(record.key);
              message.success('已删除');
              tableRef.current?.reload();
            }}
          >
            <a style={{ color: '#ff4d4f' }}>删除</a>
          </Popconfirm>,
        ];
      },
    },
  ];

  return (
    <PageContainer
      header={{ title: '配置中心' }}
      extra={
        canWrite
          ? [
              <ModalForm
                key="create"
                title="新增配置"
                width={520}
                trigger={<Button type="primary">新增配置</Button>}
                modalProps={{ destroyOnClose: true }}
                initialValues={{ value: '{}' }}
                onFinish={submit as any}
              >
                <ProFormText name="key" label="key" rules={[{ required: true }]} />
                <ProFormText name="description" label="说明" />
                <ProFormTextArea
                  name="value"
                  label="value (JSON)"
                  fieldProps={{ rows: 8 }}
                  rules={[{ required: true }]}
                />
              </ModalForm>,
            ]
          : []
      }
    >
      <ProTable<GameConfigView>
        rowKey="id"
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
