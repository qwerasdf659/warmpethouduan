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
import { Popconfirm, Tag, message } from 'antd';
import { cancelOrder, listOrders, shipOrder } from '@/services/exchange';
import type { RedeemOrderView } from '@/types';

const statusTag = (s: RedeemOrderView['status']) => {
  if (s === 'pending') return <Tag color="orange">待处理</Tag>;
  if (s === 'shipped') return <Tag color="green">已发货/发放</Tag>;
  return <Tag color="red">已取消</Tag>;
};

export default function ExchangePage() {
  const access = useAccess();
  const tableRef = useRef<ActionType>();

  const columns: ProColumns<RedeemOrderView>[] = [
    { title: '订单ID', dataIndex: 'id', width: 90, hideInSearch: true },
    {
      title: '玩家ID',
      dataIndex: 'userId',
      width: 100,
      fieldProps: { placeholder: '按玩家ID过滤' },
    },
    { title: '商品', dataIndex: 'itemName', hideInSearch: true },
    {
      title: '类型',
      dataIndex: 'itemType',
      width: 80,
      hideInSearch: true,
      render: (_, r) =>
        r.itemType === 'physical' ? (
          <Tag color="blue">实物</Tag>
        ) : (
          <Tag>虚拟</Tag>
        ),
    },
    { title: '花费', dataIndex: 'cost', width: 90, hideInSearch: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      valueType: 'select',
      valueEnum: {
        pending: { text: '待处理' },
        shipped: { text: '已发货/发放' },
        cancelled: { text: '已取消' },
      },
      render: (_, r) => statusTag(r.status),
    },
    {
      title: '收货信息',
      dataIndex: 'address',
      hideInSearch: true,
      render: (_, r) =>
        r.address
          ? `${r.address.receiver} ${r.address.phone} ${r.address.region}${r.address.detail}`
          : '-',
    },
    { title: '物流单号', dataIndex: 'trackingNo', hideInSearch: true, render: (v) => (v as string) ?? '-' },
    {
      title: '下单时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 170,
      hideInSearch: true,
    },
    {
      // 履约时间独立落列，不是 updatedAt——后者会被补单号/改备注刷新，算时效会偏短
      title: '履约时间',
      dataIndex: 'shippedAt',
      width: 170,
      hideInSearch: true,
      render: (_, r) => {
        const at = r.status === 'cancelled' ? r.cancelledAt : r.shippedAt;
        if (!at) return '-';
        const label = r.status === 'cancelled' ? '取消' : '发货';
        return `${label} ${new Date(at).toLocaleString('zh-CN')}`;
      },
    },
    {
      title: '履约耗时',
      dataIndex: 'id',
      width: 110,
      hideInSearch: true,
      render: (_, r) => {
        const at = r.status === 'cancelled' ? r.cancelledAt : r.shippedAt;
        if (!at) return '-';
        const ms = new Date(at).getTime() - new Date(r.createdAt).getTime();
        if (ms < 0) return '-';
        const hours = ms / 3_600_000;
        return hours < 1
          ? `${Math.round(ms / 60_000)} 分钟`
          : `${hours.toFixed(1)} 小时`;
      },
    },
    {
      title: '操作',
      valueType: 'option',
      width: 150,
      render: (_, record) => {
        if (!access.canWriteExchange || record.status !== 'pending') return '-';
        return [
          <ModalForm
            key="ship"
            title={`发货 · 订单 #${record.id}`}
            width={420}
            trigger={<a>发货</a>}
            modalProps={{ destroyOnClose: true }}
            onFinish={async (v: { trackingNo?: string; remark?: string }) => {
              await shipOrder(record.id, v);
              message.success('已发货');
              tableRef.current?.reload();
              return true;
            }}
          >
            <ProFormText
              name="trackingNo"
              label="物流单号"
              placeholder={record.itemType === 'physical' ? '实物请填写' : '虚拟可留空'}
            />
            <ProFormTextArea name="remark" label="备注" />
          </ModalForm>,
          <Popconfirm
            key="cancel"
            title="取消并退款该订单？"
            onConfirm={async () => {
              await cancelOrder(record.id, { reason: '运营取消' });
              message.success('已取消并退款');
              tableRef.current?.reload();
            }}
          >
            <a style={{ color: '#ff4d4f' }}>取消退款</a>
          </Popconfirm>,
        ];
      },
    },
  ];

  return (
    <PageContainer header={{ title: '兑换管理' }}>
      <ProTable<RedeemOrderView>
        rowKey="id"
        actionRef={tableRef}
        columns={columns}
        pagination={{ pageSize: 20 }}
        search={{ labelWidth: 'auto' }}
        request={async (params) => {
          const res = await listOrders({
            page: params.current ?? 1,
            pageSize: params.pageSize ?? 20,
            status: (params as any).status || undefined,
            userId: (params as any).userId || undefined,
          });
          return { data: res.list, total: res.total, success: true };
        }}
      />
    </PageContainer>
  );
}
