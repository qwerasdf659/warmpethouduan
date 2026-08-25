import { PlusOutlined } from '@ant-design/icons';
import {
  ModalForm,
  PageContainer,
  ProFormSelect,
  ProFormText,
  ProTable,
} from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Access, useAccess } from '@umijs/max';
import { Button, message, Popconfirm, Tag } from 'antd';
import { useEffect, useRef, useState } from 'react';
import {
  createAdminUser,
  deleteAdminUser,
  listAdminUsers,
  resetAdminUserPassword,
  setAdminUserRoles,
  updateAdminUser,
} from '@/services/admin-user';
import { listRoles } from '@/services/role';
import type { AdminUserView, Role } from '@/types';

export default function AdminUserPage() {
  const actionRef = useRef<ActionType>();
  const access = useAccess();
  const [roles, setRoles] = useState<Role[]>([]);

  useEffect(() => {
    listRoles().then(setRoles).catch(() => void 0);
  }, []);

  const roleOptions = roles.map((r) => ({ label: r.name, value: r.id }));

  const columns: ProColumns<AdminUserView>[] = [
    { title: '用户名', dataIndex: 'username', copyable: true },
    {
      title: '显示名',
      dataIndex: 'displayName',
      render: (v) => (v as string) ?? '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (_, r) =>
        r.status === 'active' ? (
          <Tag color="green">启用</Tag>
        ) : (
          <Tag color="red">停用</Tag>
        ),
    },
    {
      title: '角色',
      dataIndex: 'roles',
      render: (_, r) =>
        (r.roles ?? []).map((role) => (
          <Tag key={role.id} color="blue">
            {role.name}
          </Tag>
        )),
    },
    {
      title: '最近登录',
      dataIndex: 'lastLoginAt',
      valueType: 'dateTime',
      width: 180,
      render: (_, r) =>
        r.lastLoginAt ? new Date(r.lastLoginAt).toLocaleString() : '-',
    },
    {
      title: '操作',
      valueType: 'option',
      width: 300,
      render: (_, record) => [
        <Access key="edit" accessible={access.canWriteAdmin}>
          <ModalForm
            title="编辑管理员"
            trigger={<a>编辑</a>}
            modalProps={{ destroyOnClose: true }}
            initialValues={record}
            onFinish={async (values: any) => {
              await updateAdminUser(record.id, {
                displayName: values.displayName,
                status: values.status,
              });
              message.success('已更新');
              actionRef.current?.reload();
              return true;
            }}
          >
            <ProFormText name="displayName" label="显示名" />
            <ProFormSelect
              name="status"
              label="状态"
              options={[
                { label: '启用', value: 'active' },
                { label: '停用', value: 'disabled' },
              ]}
            />
          </ModalForm>
        </Access>,
        <Access key="roles" accessible={access.canWriteAdmin}>
          <ModalForm
            title="分配角色"
            trigger={<a>分配角色</a>}
            modalProps={{ destroyOnClose: true }}
            initialValues={{ roleIds: (record.roles ?? []).map((r) => r.id) }}
            onFinish={async (values: any) => {
              await setAdminUserRoles(record.id, values.roleIds ?? []);
              message.success('角色已保存');
              actionRef.current?.reload();
              return true;
            }}
          >
            <ProFormSelect
              name="roleIds"
              label="角色"
              mode="multiple"
              options={roleOptions}
            />
          </ModalForm>
        </Access>,
        <Access key="pwd" accessible={access.canWriteAdmin}>
          <ModalForm
            title="重置密码"
            trigger={<a>重置密码</a>}
            modalProps={{ destroyOnClose: true }}
            onFinish={async (values: any) => {
              await resetAdminUserPassword(record.id, values.newPassword);
              message.success('密码已重置');
              return true;
            }}
          >
            <ProFormText.Password
              name="newPassword"
              label="新密码"
              rules={[{ required: true, min: 8, message: '至少 8 位' }]}
            />
          </ModalForm>
        </Access>,
        <Access key="del" accessible={access.canWriteAdmin}>
          <Popconfirm
            title="确认删除该管理员？"
            onConfirm={async () => {
              await deleteAdminUser(record.id);
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
    <PageContainer header={{ title: '管理员' }}>
      <ProTable<AdminUserView>
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        search={false}
        pagination={{ pageSize: 20 }}
        request={async (params) => {
          const res = await listAdminUsers({
            page: params.current ?? 1,
            pageSize: params.pageSize ?? 20,
          });
          return { data: res.list, total: res.total, success: true };
        }}
        toolBarRender={() => [
          <Access key="add" accessible={access.canWriteAdmin}>
            <ModalForm
              title="新增管理员"
              trigger={
                <Button type="primary" icon={<PlusOutlined />}>
                  新增
                </Button>
              }
              modalProps={{ destroyOnClose: true }}
              onFinish={async (values: any) => {
                await createAdminUser(values);
                message.success('已创建');
                actionRef.current?.reload();
                return true;
              }}
            >
              <ProFormText
                name="username"
                label="用户名"
                rules={[{ required: true }]}
              />
              <ProFormText.Password
                name="password"
                label="密码"
                rules={[{ required: true, min: 8, message: '至少 8 位' }]}
              />
              <ProFormText name="displayName" label="显示名" />
              <ProFormSelect
                name="roleIds"
                label="角色"
                mode="multiple"
                options={roleOptions}
              />
            </ModalForm>
          </Access>,
        ]}
      />
    </PageContainer>
  );
}
