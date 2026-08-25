import { PlusOutlined } from '@ant-design/icons';
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
import { Access, useAccess } from '@umijs/max';
import { Button, message, Popconfirm, Tag } from 'antd';
import { useEffect, useRef, useState } from 'react';
import {
  createMenu,
  deleteMenu,
  listMenus,
  updateMenu,
} from '@/services/menu';
import { listPermissions } from '@/services/permission';
import type { MenuNode, Permission } from '@/types';

const TYPE_LABEL: Record<string, string> = {
  catalog: '目录',
  menu: '页面',
  button: '按钮',
};

export default function MenuPage() {
  const actionRef = useRef<ActionType>();
  const access = useAccess();
  const [menus, setMenus] = useState<MenuNode[]>([]);
  const [perms, setPerms] = useState<Permission[]>([]);

  useEffect(() => {
    listPermissions().then(setPerms).catch(() => void 0);
  }, []);

  const parentOptions = [
    { label: '（顶级）', value: '' },
    ...menus
      .filter((m) => m.type === 'catalog' || m.type === 'menu')
      .map((m) => ({ label: m.name, value: m.id })),
  ];
  const permOptions = perms.map((p) => ({
    label: `${p.name}（${p.code}）`,
    value: p.code,
  }));

  const commonFields = (
    <>
      <ProFormText name="name" label="名称" rules={[{ required: true }]} />
      <ProFormSelect
        name="type"
        label="类型"
        options={[
          { label: '目录', value: 'catalog' },
          { label: '页面', value: 'menu' },
          { label: '按钮', value: 'button' },
        ]}
        rules={[{ required: true }]}
      />
      <ProFormSelect name="parentId" label="上级" options={parentOptions} />
      <ProFormText name="path" label="路由 path" placeholder="如 /system/roles" />
      <ProFormText name="component" label="组件路径" placeholder="如 ./System/Role" />
      <ProFormText name="icon" label="图标" placeholder="如 SettingOutlined" />
      <ProFormSelect
        name="permissionCode"
        label="关联权限"
        options={permOptions}
        showSearch
      />
      <ProFormDigit name="sortOrder" label="排序" initialValue={0} />
      <ProFormSwitch name="visible" label="可见" initialValue={true} />
    </>
  );

  const columns: ProColumns<MenuNode>[] = [
    { title: '名称', dataIndex: 'name' },
    {
      title: '类型',
      dataIndex: 'type',
      width: 90,
      render: (_, r) => <Tag>{TYPE_LABEL[r.type] ?? r.type}</Tag>,
    },
    { title: '路由', dataIndex: 'path', render: (v) => (v as string) ?? '-' },
    {
      title: '关联权限',
      dataIndex: 'permissionCode',
      render: (v) => (v as string) ?? '-',
    },
    { title: '排序', dataIndex: 'sortOrder', width: 70 },
    {
      title: '可见',
      dataIndex: 'visible',
      width: 70,
      render: (_, r) => (r.visible ? '是' : '否'),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 140,
      render: (_, record) => [
        <Access key="edit" accessible={access.canWriteMenu}>
          <ModalForm
            title="编辑菜单"
            trigger={<a>编辑</a>}
            modalProps={{ destroyOnClose: true }}
            initialValues={{ ...record, parentId: record.parentId ?? '' }}
            onFinish={async (values: any) => {
              await updateMenu(record.id, {
                ...values,
                parentId: values.parentId || null,
              });
              message.success('已更新');
              actionRef.current?.reload();
              return true;
            }}
          >
            {commonFields}
          </ModalForm>
        </Access>,
        <Access key="del" accessible={access.canWriteMenu}>
          <Popconfirm
            title="确认删除该菜单？"
            onConfirm={async () => {
              await deleteMenu(record.id);
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
    <PageContainer header={{ title: '菜单' }}>
      <ProTable<MenuNode>
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        search={false}
        pagination={false}
        request={async () => {
          const list = await listMenus();
          setMenus(list);
          return { data: list, total: list.length, success: true };
        }}
        toolBarRender={() => [
          <Access key="add" accessible={access.canWriteMenu}>
            <ModalForm
              title="新增菜单"
              trigger={
                <Button type="primary" icon={<PlusOutlined />}>
                  新增
                </Button>
              }
              modalProps={{ destroyOnClose: true }}
              onFinish={async (values: any) => {
                await createMenu({
                  ...values,
                  parentId: values.parentId || null,
                });
                message.success('已创建');
                actionRef.current?.reload();
                return true;
              }}
            >
              {commonFields}
            </ModalForm>
          </Access>,
        ]}
      />
    </PageContainer>
  );
}
