import { PlusOutlined } from '@ant-design/icons';
import {
  ModalForm,
  PageContainer,
  ProFormText,
  ProTable,
} from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Access, useAccess } from '@umijs/max';
import { Button, message, Popconfirm } from 'antd';
import { useRef } from 'react';
import {
  createPermission,
  deletePermission,
  listPermissions,
} from '@/services/permission';
import type { Permission } from '@/types';

export default function PermissionPage() {
  const actionRef = useRef<ActionType>();
  const access = useAccess();

  const columns: ProColumns<Permission>[] = [
    { title: '分组', dataIndex: 'group', width: 120, render: (v) => v ?? '-' },
    { title: '权限码', dataIndex: 'code', copyable: true },
    { title: '名称', dataIndex: 'name' },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 180,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 80,
      render: (_, record) => [
        <Access key="del" accessible={access.canWritePermission}>
          <Popconfirm
            title="确认删除该权限？"
            onConfirm={async () => {
              await deletePermission(record.id);
              message.success('已删除');
              actionRef.current?.reload();
            }}
          >
            <a style={{ color: '#ff4d4f' }}>删除</a>
          </Popconfirm>
        </Access>,
      ],
    },
  ];

  return (
    <PageContainer header={{ title: '权限' }}>
      <ProTable<Permission>
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        search={false}
        pagination={{ pageSize: 20 }}
        request={async () => {
          const list = await listPermissions();
          return { data: list, total: list.length, success: true };
        }}
        toolBarRender={() => [
          <Access key="add" accessible={access.canWritePermission}>
            <ModalForm<{ code: string; name: string; group?: string }>
              title="新增权限"
              trigger={
                <Button type="primary" icon={<PlusOutlined />}>
                  新增
                </Button>
              }
              modalProps={{ destroyOnClose: true }}
              onFinish={async (values) => {
                await createPermission(values);
                message.success('已创建');
                actionRef.current?.reload();
                return true;
              }}
            >
              <ProFormText
                name="code"
                label="权限码"
                placeholder="如 player:read"
                rules={[{ required: true }]}
              />
              <ProFormText
                name="name"
                label="名称"
                rules={[{ required: true }]}
              />
              <ProFormText name="group" label="分组" placeholder="如 运营" />
            </ModalForm>
          </Access>,
        ]}
      />
    </PageContainer>
  );
}
