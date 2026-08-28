import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { Space, Tag, Tooltip, Typography } from 'antd';
import { listTradeOffers } from '@/services/gameplay';
import type { TradeOfferItemView, TradeOfferView } from '@/types';

const STATUS: Record<
  TradeOfferView['status'],
  { text: string; color: string }
> = {
  pending: { text: '待接受', color: 'processing' },
  accepted: { text: '已成交', color: 'success' },
  rejected: { text: '已拒绝', color: 'default' },
  cancelled: { text: '已撤销', color: 'warning' },
  expired: { text: '已过期', color: 'default' },
};

/**
 * 双向易货报价单。
 *
 * 易货在建单时就冻结/托管双方资产，所以 pending 的单意味着「两个玩家的东西
 * 正锁着」。玩家来问「我的皮肤怎么用不了」，这页是第一站。
 */
export default function TradePage() {
  const columns: ProColumns<TradeOfferView>[] = [
    { title: '报价ID', dataIndex: 'id', width: 90, hideInSearch: true },
    {
      title: '玩家ID',
      dataIndex: 'userId',
      width: 110,
      hideInTable: true,
      fieldProps: { placeholder: '发起方或接收方任一命中' },
    },
    {
      title: '发起方',
      dataIndex: 'fromUserId',
      width: 100,
      hideInSearch: true,
      copyable: true,
    },
    {
      title: '发起方付出',
      dataIndex: 'fromItems',
      hideInSearch: true,
      render: (_, r) => <Side coin={r.fromCoin} items={r.fromItems} />,
    },
    {
      title: '接收方',
      dataIndex: 'toUserId',
      width: 100,
      hideInSearch: true,
      copyable: true,
    },
    {
      title: '接收方付出',
      dataIndex: 'toItems',
      hideInSearch: true,
      render: (_, r) => <Side coin={r.toCoin} items={r.toItems} />,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      valueType: 'select',
      valueEnum: {
        pending: { text: '待接受' },
        accepted: { text: '已成交' },
        rejected: { text: '已拒绝' },
        cancelled: { text: '已撤销' },
        expired: { text: '已过期' },
      },
      render: (_, r) => {
        const s = STATUS[r.status];
        return s ? <Tag color={s.color}>{s.text}</Tag> : r.status;
      },
    },
    {
      title: '过期时间',
      dataIndex: 'expiresAt',
      valueType: 'dateTime',
      hideInSearch: true,
      width: 170,
    },
    {
      title: '结算凭证',
      dataIndex: 'settledTxnId',
      width: 110,
      hideInSearch: true,
      render: (_, r) => r.settledTxnId ?? '-',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      hideInSearch: true,
      width: 170,
    },
  ];

  return (
    <PageContainer
      header={{ title: '易货报价' }}
      content="双向易货在建单时即冻结/托管双方资产。状态为「待接受」的单，双方的标的都处于锁定中。"
    >
      <ProTable<TradeOfferView>
        rowKey="id"
        headerTitle="报价单"
        cardBordered
        columns={columns}
        scroll={{ x: 'max-content' }}
        search={{ labelWidth: 'auto' }}
        pagination={{
          pageSize: 20,
          showTotal: (t) => `共 ${t.toLocaleString('zh-CN')} 条`,
        }}
        request={async (params) => {
          const res = await listTradeOffers({
            page: params.current ?? 1,
            pageSize: params.pageSize ?? 20,
            userId: params.userId,
            status: params.status,
          });
          return { data: res.list, total: res.total, success: true };
        }}
      />
    </PageContainer>
  );
}

/** 一侧付出的标的：币 + 物品。物品可能是可叠加资产，也可能是唯一实例。 */
function Side({ coin, items }: { coin: string; items: TradeOfferItemView[] }) {
  const coinNum = Number(coin ?? 0);
  if (!coinNum && !items.length) {
    return <Typography.Text type="secondary">-</Typography.Text>;
  }
  return (
    <Space size={4} wrap>
      {coinNum ? (
        <Tag color="gold">{coinNum.toLocaleString('zh-CN')} 币</Tag>
      ) : null}
      {items.map((it) => (
        <Tooltip
          key={it.id}
          title={it.instanceId ? `唯一实例 #${it.instanceId}` : '可叠加资产'}
        >
          <Tag>
            {it.assetCode ?? `实例#${it.instanceId}`}
            {it.qty && Number(it.qty) > 1 ? ` ×${it.qty}` : ''}
          </Tag>
        </Tooltip>
      ))}
    </Space>
  );
}
