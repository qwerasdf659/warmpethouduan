import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { Alert, Tag, Typography } from 'antd';
import { listMarketBids } from '@/services/gameplay';
import type { MarketBidView } from '@/types';

const STATUS: Record<
  MarketBidView['status'],
  { text: string; color: string; hint: string }
> = {
  active: { text: '生效中', color: 'processing', hint: '资金仍处于冻结状态' },
  outbid: { text: '已被超越', color: 'default', hint: '资金已解冻退回' },
  won: { text: '已中标', color: 'success', hint: '资金已用于成交' },
  cancelled: { text: '已撤销', color: 'warning', hint: '资金已解冻退回' },
};

/**
 * 竞价出价。
 *
 * 出价即冻结买家资金，所以这页回答的是资金问题而不只是行情：谁的钱还锁着、
 * 锁在哪张单上、对应哪张冻结凭证。强制撤单会解冻全部生效中的出价 ——
 * 在有这页之前，运营是闭着眼点撤单的。
 */
export default function BidsPage() {
  const columns: ProColumns<MarketBidView>[] = [
    { title: '出价ID', dataIndex: 'id', width: 90, hideInSearch: true },
    { title: '挂单ID', dataIndex: 'listingId', width: 100, copyable: true },
    {
      title: '标的',
      dataIndex: 'assetCode',
      width: 160,
      hideInSearch: true,
      render: (_, r) => r.assetCode ?? '-',
    },
    {
      title: '出价人',
      dataIndex: 'userId',
      width: 110,
      render: (_, r) => r.bidderUserId ?? `账户#${r.bidderAccountId}`,
    },
    {
      title: '出价',
      dataIndex: 'price',
      width: 120,
      hideInSearch: true,
      align: 'right',
      render: (_, r) => Number(r.price).toLocaleString('zh-CN'),
    },
    {
      title: '出价状态',
      dataIndex: 'status',
      width: 130,
      valueType: 'select',
      valueEnum: {
        active: { text: '生效中' },
        outbid: { text: '已被超越' },
        won: { text: '已中标' },
        cancelled: { text: '已撤销' },
      },
      render: (_, r) => {
        const s = STATUS[r.status];
        if (!s) return r.status;
        return (
          <Typography.Text title={s.hint}>
            <Tag color={s.color}>{s.text}</Tag>
          </Typography.Text>
        );
      },
    },
    {
      title: '挂单状态',
      dataIndex: 'listingStatus',
      width: 110,
      hideInSearch: true,
      render: (_, r) => r.listingStatus ?? '-',
    },
    {
      title: '冻结凭证',
      dataIndex: 'freezeTxnId',
      width: 120,
      hideInSearch: true,
      copyable: true,
      // 追「这笔钱现在还锁着吗」时，拿它去钱包流水里查
      tooltip: '可用该 txn id 到「钱包流水」核对冻结与解冻',
    },
    {
      title: '出价时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      hideInSearch: true,
      width: 170,
    },
  ];

  return (
    <PageContainer header={{ title: '竞价出价' }}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="出价即冻结买家资金"
        description="「生效中」表示这笔钱仍锁在买家账上。对挂单执行强制撤单会解冻全部生效中的出价，操作前建议先在这里按挂单ID核对一遍。"
      />
      <ProTable<MarketBidView>
        rowKey="id"
        headerTitle="出价记录"
        cardBordered
        columns={columns}
        scroll={{ x: 'max-content' }}
        search={{ labelWidth: 'auto' }}
        pagination={{
          pageSize: 20,
          showTotal: (t) => `共 ${t.toLocaleString('zh-CN')} 条`,
        }}
        request={async (params) => {
          const res = await listMarketBids({
            page: params.current ?? 1,
            pageSize: params.pageSize ?? 20,
            listingId: params.listingId,
            userId: params.userId,
            status: params.status,
          });
          return { data: res.list, total: res.total, success: true };
        }}
      />
    </PageContainer>
  );
}
