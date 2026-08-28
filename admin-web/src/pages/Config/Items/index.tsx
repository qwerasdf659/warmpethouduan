import {
  ModalForm,
  PageContainer,
  ProFormDigit,
  ProFormSelect,
  ProFormSwitch,
  ProFormText,
  ProFormTextArea,
  ProTable,
} from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { useEffect, useRef, useState } from 'react';
import { Button, Popconfirm, Tag, message } from 'antd';
import {
  createItem,
  deleteItem,
  getConfig,
  listItems,
  updateItem,
} from '@/services/config';
import type { ItemDefView, RarityDef } from '@/types';

const typeText: Record<string, string> = {
  skin: '皮肤',
  accessory: '配饰',
  furniture: '家具',
  consumable: '消耗品',
  petpet: '宠物',
  coupon: '优惠券',
};

export default function ItemsPage() {
  const access = useAccess();
  const tableRef = useRef<ActionType>();
  const canWrite = access.canWriteConfig;

  /*
   * 稀有度色标取自配置中心的 `items.rarities`，不在前端另写一份。
   *
   * 之前这里硬编码了一张 4 键的表，而配置中心里那份有 5 档且运营可编辑——
   * 于是「改了颜色不生效」，并且 `uncommon` 因为不在硬编码表里，
   * 一直被渲染成灰色。同一件事有两个真相时，坏的那个不会自己暴露。
   */
  const [rarities, setRarities] = useState<RarityDef[]>([]);
  useEffect(() => {
    getConfig('items.rarities')
      .then((c) => setRarities((c.value as RarityDef[]) ?? []))
      // 取不到就退化成「只显示 key 不上色」，不该因为色标拖垮整个物品列表
      .catch(() => setRarities([]));
  }, []);

  const columns: ProColumns<ItemDefView>[] = [
    { title: 'code', dataIndex: 'code', copyable: true },
    {
      title: '类型',
      dataIndex: 'type',
      width: 90,
      valueType: 'select',
      valueEnum: {
        skin: { text: '皮肤' },
        accessory: { text: '配饰' },
        furniture: { text: '家具' },
        consumable: { text: '消耗品' },
        petpet: { text: '宠物' },
        coupon: { text: '优惠券' },
      },
      render: (_, r) => <Tag>{typeText[r.type ?? ''] ?? r.type ?? '-'}</Tag>,
    },
    { title: '名称', dataIndex: 'name', hideInSearch: true },
    {
      title: '稀有度',
      width: 90,
      hideInSearch: true,
      render: (_, r) => {
        const rarity = (r.meta?.rarity as string) ?? '';
        if (!rarity) return '-';
        const def = rarities.find((d) => d.key === rarity);
        return <Tag color={def?.color}>{def?.name ?? rarity}</Tag>;
      },
    },
    {
      title: '槽位',
      dataIndex: 'slot',
      hideInSearch: true,
      render: (v) => (v as string) ?? '-',
    },
    { title: '价格', dataIndex: 'price', width: 80, hideInSearch: true },
    {
      title: '池',
      dataIndex: 'priceAsset',
      width: 90,
      hideInSearch: true,
      render: (_, r) =>
        r.priceAsset === 'marketing_point' ? '营销积分' : '游戏币',
    },
    { title: '舒适度', dataIndex: 'comfort', width: 80, hideInSearch: true },
    {
      // 三个合规开关只读展示。它们的取值组合由数据库 CHECK 约束把死，
      // 后台改不了 —— 放开需要显式迁移 + 在架构文档追加决策记录。
      title: '合规',
      width: 150,
      hideInSearch: true,
      render: (_, r) => (
        <>
          {r.tradable ? <Tag color="blue">可交易</Tag> : null}
          {r.redeemable ? <Tag color="gold">可兑实物</Tag> : null}
          {r.gachaOutput ? <Tag color="purple">扭蛋产出</Tag> : null}
        </>
      ),
    },
    {
      title: '限量',
      width: 100,
      hideInSearch: true,
      render: (_, r) =>
        r.mintLimit === null ? '-' : `${r.mintedCount}/${r.mintLimit}`,
    },
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
            title={`编辑物品 · ${record.code}`}
            trigger={<a>编辑</a>}
            initialValues={record}
            onSubmit={async (v) => {
              await updateItem(record.code, v);
              message.success('已保存');
              tableRef.current?.reload();
            }}
            editing
          />,
          <Popconfirm
            key="del"
            title="确认删除该资产定义？已有流水或持有记录的资产不能删，请改为下架。"
            onConfirm={async () => {
              await deleteItem(record.code);
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
        rowKey="code"
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
  onSubmit: (v: Partial<ItemDefView> & { key?: string }) => Promise<void>;
  editing?: boolean;
}) {
  return (
    <ModalForm
      title={title}
      width={480}
      trigger={trigger}
      modalProps={{ destroyOnClose: true }}
      initialValues={
        initialValues
          ? {
              ...initialValues,
              meta:
                initialValues.meta && Object.keys(initialValues.meta).length
                  ? JSON.stringify(initialValues.meta, null, 2)
                  : '',
            }
          : {
              type: 'skin',
              priceAsset: 'game_coin',
              enabled: true,
              price: 0,
            }
      }
      onFinish={async (v: any) => {
        const { meta, ...rest } = v;
        let parsedMeta: Record<string, unknown> | undefined;
        if (meta && String(meta).trim()) {
          try {
            parsedMeta = JSON.parse(meta);
          } catch {
            message.error('必须是合法 JSON');
            return false;
          }
        }
        await onSubmit(parsedMeta ? { ...rest, meta: parsedMeta } : rest);
        return true;
      }}
    >
      {/*
        新建时字段名是 `key`（后端 CreateItemDefDto 用它当 code）；
        编辑时 code 不可改 —— 它是主键，且历史分录都按它引用资产。
      */}
      {!editing ? (
        <ProFormText
          name="key"
          label="code"
          tooltip="资产唯一标识，如 skin_tiger。创建后不可修改"
          rules={[{ required: true }]}
        />
      ) : null}
      {!editing ? (
        <ProFormSelect
          name="type"
          label="类型"
          tooltip="皮肤/配饰是唯一物品（可编号、按件交易），家具/消耗品按数量"
          options={[
            { label: '皮肤', value: 'skin' },
            { label: '配饰', value: 'accessory' },
            { label: '家具', value: 'furniture' },
            { label: '消耗品', value: 'consumable' },
            { label: '宠物', value: 'petpet' },
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
        name="priceAsset"
        label="积分池"
        options={[
          { label: '游戏币', value: 'game' },
          { label: '营销积分', value: 'marketing' },
        ]}
        rules={[{ required: true }]}
      />
      <ProFormDigit name="comfort" label="舒适度(家具)" min={0} />
      <ProFormDigit name="gridW" label="占格宽(家具)" min={1} />
      <ProFormDigit name="gridH" label="占格高(家具)" min={1} />
      <ProFormDigit
        name="mintLimit"
        label="限量总量"
        min={1}
        tooltip="仅皮肤/配饰有效。留空为不限量。已售出后只能上调，不能下调"
      />
      <ProFormDigit name="sortOrder" label="排序" />
      <ProFormSwitch name="enabled" label="上架" />
      <ProFormTextArea
        name="meta"
        label="meta (JSON)"
        fieldProps={{ rows: 6 }}
        extra="itemType / slot / price / priceAsset 请用上方表单项，在此填写 bonus / rarity 等无专属控件的键"
      />
    </ModalForm>
  );
}
