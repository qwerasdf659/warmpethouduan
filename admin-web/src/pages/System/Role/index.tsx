import { PlusOutlined } from '@ant-design/icons';
import {
  ModalForm,
  PageContainer,
  ProFormText,
  ProFormTextArea,
  ProTable,
} from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Access, useAccess } from '@umijs/max';
import { Button, message, Modal, Popconfirm, Tag, Tree } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { useEffect, useMemo, useRef, useState } from 'react';
import { listMenus } from '@/services/menu';
import { listPermissions } from '@/services/permission';
import {
  createRole,
  deleteRole,
  getRole,
  listRoles,
  setRoleMenus,
  setRolePermissions,
  updateRole,
} from '@/services/role';
import type { MenuNode, Permission, Role } from '@/types';

function buildMenuTree(menus: MenuNode[]): DataNode[] {
  const byParent = new Map<string | null, MenuNode[]>();
  for (const m of menus) {
    const key = m.parentId;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(m);
  }
  const make = (parentId: string | null): DataNode[] =>
    (byParent.get(parentId) ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((m) => ({
        key: m.id,
        title: `${m.name}（${m.type}）`,
        children: make(m.id),
      }));
  return make(null);
}

export default function RolePage() {
  const actionRef = useRef<ActionType>();
  const access = useAccess();

  const [perms, setPerms] = useState<Permission[]>([]);
  const [menus, setMenus] = useState<MenuNode[]>([]);
  const permIds = useMemo(() => new Set(perms.map((p) => p.id)), [perms]);

  const [permModal, setPermModal] = useState<{ role: Role } | null>(null);
  const [menuModal, setMenuModal] = useState<{ role: Role } | null>(null);
  const [checkedPerms, setCheckedPerms] = useState<string[]>([]);
  const [checkedMenus, setCheckedMenus] = useState<string[]>([]);

  useEffect(() => {
    listPermissions().then(setPerms).catch(() => void 0);
    listMenus().then(setMenus).catch(() => void 0);
  }, []);

  const permTree: DataNode[] = useMemo(() => {
    const byGroup = new Map<string, Permission[]>();
    for (const p of perms) {
      const g = p.group ?? '其他';
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(p);
    }
    return [...byGroup.entries()].map(([g, items]) => ({
      key: `group:${g}`,
      title: g,
      selectable: false,
      children: items.map((p) => ({ key: p.id, title: `${p.name}（${p.code}）` })),
    }));
  }, [perms]);

  const menuTree = useMemo(() => buildMenuTree(menus), [menus]);

  const openPermModal = async (role: Role) => {
    const full = await getRole(role.id);
    setCheckedPerms((full.permissions ?? []).map((p) => p.id));
    setPermModal({ role: full });
  };
  const openMenuModal = async (role: Role) => {
    const full = await getRole(role.id);
    setCheckedMenus((full.menus ?? []).map((m) => m.id));
    setMenuModal({ role: full });
  };

  const columns: ProColumns<Role>[] = [
    { title: '角色码', dataIndex: 'code', copyable: true },
    { title: '名称', dataIndex: 'name' },
    {
      title: '描述',
      dataIndex: 'description',
      render: (v) => (v as string) ?? '-',
    },
    {
      title: '内置',
      dataIndex: 'isSystem',
      width: 80,
      render: (_, r) =>
        r.isSystem ? <Tag color="gold">内置</Tag> : <Tag>自定义</Tag>,
    },
    {
      title: '权限数',
      width: 80,
      render: (_, r) => r.permissions?.length ?? 0,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 260,
      render: (_, record) => [
        <Access key="perm" accessible={access.canWriteRole}>
          <a onClick={() => openPermModal(record)}>分配权限</a>
        </Access>,
        <Access key="menu" accessible={access.canWriteRole}>
          <a onClick={() => openMenuModal(record)}>分配菜单</a>
        </Access>,
        <Access key="edit" accessible={access.canWriteRole}>
          <ModalForm
            title="编辑角色"
            trigger={<a>编辑</a>}
            modalProps={{ destroyOnClose: true }}
            initialValues={record}
            onFinish={async (values: any) => {
              await updateRole(record.id, {
                name: values.name,
                description: values.description,
              });
              message.success('已更新');
              actionRef.current?.reload();
              return true;
            }}
          >
            <ProFormText name="name" label="名称" rules={[{ required: true }]} />
            <ProFormTextArea name="description" label="描述" />
          </ModalForm>
        </Access>,
        record.isSystem ? null : (
          <Access key="del" accessible={access.canWriteRole}>
            <Popconfirm
              title="确认删除该角色？"
              onConfirm={async () => {
                await deleteRole(record.id);
                message.success('已删除');
                actionRef.current?.reload();
              }}
            >
              <a style={{ color: '#ff4d4f' }}>删除</a>
            </Popconfirm>
          </Access>
        ),
      ],
    },
  ];

  return (
    <PageContainer header={{ title: '角色' }}>
      <ProTable<Role>
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        search={false}
        pagination={false}
        request={async () => {
          const list = await listRoles();
          return { data: list, total: list.length, success: true };
        }}
        toolBarRender={() => [
          <Access key="add" accessible={access.canWriteRole}>
            <ModalForm
              title="新增角色"
              trigger={
                <Button type="primary" icon={<PlusOutlined />}>
                  新增
                </Button>
              }
              modalProps={{ destroyOnClose: true }}
              onFinish={async (values: any) => {
                await createRole(values);
                message.success('已创建');
                actionRef.current?.reload();
                return true;
              }}
            >
              <ProFormText
                name="code"
                label="角色码"
                placeholder="如 ops"
                rules={[{ required: true }]}
              />
              <ProFormText name="name" label="名称" rules={[{ required: true }]} />
              <ProFormTextArea name="description" label="描述" />
            </ModalForm>
          </Access>,
        ]}
      />

      <Modal
        title={`分配权限 · ${permModal?.role.name ?? ''}`}
        open={!!permModal}
        destroyOnClose
        onCancel={() => setPermModal(null)}
        onOk={async () => {
          if (!permModal) return;
          const ids = checkedPerms.filter((k) => permIds.has(k));
          await setRolePermissions(permModal.role.id, ids);
          message.success('权限已保存');
          setPermModal(null);
          actionRef.current?.reload();
        }}
      >
        <Tree
          checkable
          checkedKeys={checkedPerms}
          onCheck={(keys) =>
            setCheckedPerms((keys as string[]).map(String))
          }
          treeData={permTree}
          defaultExpandAll
        />
      </Modal>

      <Modal
        title={`分配菜单 · ${menuModal?.role.name ?? ''}`}
        open={!!menuModal}
        destroyOnClose
        onCancel={() => setMenuModal(null)}
        onOk={async () => {
          if (!menuModal) return;
          await setRoleMenus(menuModal.role.id, checkedMenus);
          message.success('菜单已保存');
          setMenuModal(null);
          actionRef.current?.reload();
        }}
      >
        <Tree
          checkable
          checkedKeys={checkedMenus}
          onCheck={(keys) => setCheckedMenus((keys as string[]).map(String))}
          treeData={menuTree}
          defaultExpandAll
        />
      </Modal>
    </PageContainer>
  );
}
