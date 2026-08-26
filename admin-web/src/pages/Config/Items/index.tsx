import {
  ModalForm,
  PageContainer,
  ProFormDigit,
  ProFormSelect,
  ProFormSwitch,
  ProFormText,
  ProTable,
} from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { useRef } from 'react';
import { Button, Popconfirm, Tag, message } from 'antd';
import {
  createItem,
  deleteItem,
  listItems,
  updateItem,
} from '@/services/config';
import type { ItemDefView } from '@/types';

const typeText: Record<string, string> = {
  skin: '皮肤',
  accessory: '配饰',
  furniture: '家具',
};

export default function ItemsPage() {
  const access = useAccess();
  const tableRef = useRef<ActionType>();
  const canWrite = access.canWriteConfig;

  const columns: ProColumns<ItemDefView>[] = [
    { title: 'ID', dataIndex: 'id', width: 70, hideInSearch: true },
    { title: 'key', dataIndex: 'key', copyable: true },
    {
      title: '类型',
      dataIndex: 'type',
      width: 90,
      valueType: 'select',
      valueEnum: {
        skin: { text: '皮肤' },
        accessory: { text: '配饰' },
        furniture: { text: '家具' },
      },
      render: (_, r) => <Tag>{typeText[r.type] ?? r.type}</Tag>,
    },
    { title: '名称', dataIndex: 'name', hideInSearch: true },
    {
      title: '槽位',
      dataIndex: 'slot',
      hideInSearch: true,
      render: (v) => (v as string) ?? '-',
    },
    { title: '价格', dataIndex: 'price', width: 80, hideInSearch: true },
    {
      title: '池',
      dataIndex: 'pool',
      width: 90,
      hideInSearch: true,
      render: (_, r) => (r.pool === 'game' ? '游戏币' : '营销积分'),
    },
    { title: '舒适度', dataIndex: 'comfort', width: 80, hideInSearch: true },
    {
      title: '上架',
      dataIndex: 'enabled',
      width: 80,
      hideInSearch: true,
      render: (_, r) =>
        r.enabled ? <Tag color="green">是</Tag> : <Tag>否</Tag>,
    },
    { title: '排序', dataIndex: 'sortOrder', width: 70, hideInSearch: true },
    {
      title: '操作',
      valueType: 'option',
      width: 130,
      render: (_, record) => {
        if (!canWrite) return '-';
        return [
          <ItemForm
            key="edit"
            title={`编辑物品 · ${record.key}`}
            trigger={<a>编辑</a>}
            initialValues={record}
            onSubmit={async (v) => {
              await updateItem(record.id, v);
              message.success('已保存');
              tableRef.current?.reload();
            }}
            editing
          />,
          <Popconfirm
            key="del"
            title="确认删除该物品定义？"
            onConfirm={async () => {
              await deleteItem(record.id);
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
      header={{ title: '物品管理' }}
      extra={
        canWrite
          ? [
              <ItemForm
                key="create"
                title="新建物品"
                trigger={<Button type="primary">新建物品</Button>}
                onSubmit={async (v) => {
                  await createItem(v);
                  message.success('已创建');
                  tableRef.current?.reload();
                }}
              />,
            ]
          : []
      }
    >
      <ProTable<ItemDefView>
        rowKey="id"
        actionRef={tableRef}
        columns={columns}
        search={{ labelWidth: 'auto' }}
        pagination={false}
        request={async (params) => {
          const res = await listItems((params as any).type || undefined);
          return { data: res.list, total: res.list.length, success: true };
        }}
      />
    </PageContainer>
  );
}

function ItemForm({
  title,
  trigger,
  initialValues,
  onSubmit,
  editing,
}: {
  title: string;
  trigger: React.ReactElement;
  initialValues?: Partial<ItemDefView>;
  onSubmit: (v: Partial<ItemDefView>) => Promise<void>;
  editing?: boolean;
}) {
  return (
    <ModalForm
      title={title}
      width={480}
      trigger={trigger}
      modalProps={{ destroyOnClose: true }}
      initialValues={
        initialValues ?? { type: 'skin', pool: 'game', enabled: true, price: 0 }
      }
      onFinish={async (v: any) => {
        await onSubmit(v);
        return true;
      }}
    >
      {!editing ? (
        <ProFormText name="key" label="key" rules={[{ required: true }]} />
      ) : null}
      {!editing ? (
        <ProFormSelect
          name="type"
          label="类型"
          options={[
            { label: '皮肤', value: 'skin' },
            { label: '配饰', value: 'accessory' },
            { label: '家具', value: 'furniture' },
          ]}
          rules={[{ required: true }]}
        />
      ) : null}
      <ProFormText name="name" label="名称" rules={[{ required: true }]} />
      <ProFormText
        name="slot"
        label="槽位"
        placeholder="皮肤 body / 配饰 hat；家具留空"
      />
      <ProFormDigit
        name="price"
        label="价格"
        min={0}
        rules={[{ required: true }]}
      />
      <ProFormSelect
        name="pool"
        label="积分池"
        options={[
          { label: '游戏币', value: 'game' },
          { label: '营销积分', value: 'marketing' },
        ]}
        rules={[{ required: true }]}
      />
      <ProFormDigit name="comfort" label="舒适度(家具)" min={0} />
      <ProFormDigit name="sortOrder" label="排序" />
      <ProFormSwitch name="enabled" label="上架" />
    </ModalForm>
  );
}
