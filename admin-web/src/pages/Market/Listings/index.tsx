import {
  ModalForm,
  PageContainer,
  ProFormTextArea,
  ProTable,
} from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { useEffect, useRef, useState } from 'react';
import { Alert, Descriptions, Tag, message } from 'antd';
import {
  forceCancelListing,
  getMarketStatus,
  listMarketListings,
} from '@/services/market';
import type { MarketListing, MarketStatus } from '@/types';

const statusTag = (s: MarketListing['status']) => {
  const map: Record<string, { color: string; text: string }> = {
    listed: { color: 'blue', text: '在售' },
    sold: { color: 'green', text: '已成交' },
    cancelled: { color: 'default', text: '已撤销' },
    expired: { color: 'orange', text: '已过期' },
  };
  const m = map[s] ?? { color: 'default', text: s };
  return <Tag color={m.color}>{m.text}</Tag>;
};

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;

export default function MarketListingsPage() {
  const access = useAccess();
  const tableRef = useRef<ActionType>();
  const [status, setStatus] = useState<MarketStatus | null>(null);

  useEffect(() => {
    let alive = true;
    getMarketStatus()
      .then((s) => {
        if (alive) setStatus(s);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const columns: ProColumns<MarketListing>[] = [
    { title: '挂单ID', dataIndex: 'id', width: 90, hideInSearch: true },
    {
      title: '卖家',
      dataIndex: 'sellerUserId',
      width: 100,
      fieldProps: { placeholder: '按玩家ID过滤' },
      // 后端筛选参数名与展示字段不同名，交由 request 里手动映射
      search: { transform: (v: string) => ({ sellerUserId: v }) },
    },
    {
      title: '标的',
      dataIndex: 'assetCode',
      width: 200,
      fieldProps: { placeholder: '如 skin_tiger' },
      render: (_, r) => (
        <>
          <Tag>{r.assetCode}</Tag>
          {r.qty !== null ? `×${r.qty}` : null}
          {/* 限量编号是收藏溢价的来源，纠纷处理时必须看得见具体是哪一件 */}
          {r.serial !== null ? (
            <Tag color="purple">#{r.serial}</Tag>
          ) : r.instanceId ? (
            <Tag>实例 {r.instanceId}</Tag>
          ) : null}
        </>
      ),
    },
    {
      title: '模式',
      dataIndex: 'mode',
      width: 90,
      valueType: 'select',
      valueEnum: {
        fixed: { text: '一价' },
        auction: { text: '竞价' },
      },
      render: (_, r) => (
        <Tag color={r.mode === 'auction' ? 'gold' : 'cyan'}>
          {r.mode === 'auction' ? '竞价' : '一价'}
        </Tag>
      ),
    },
    {
      title: '价格',
      dataIndex: 'price',
      width: 130,
      hideInSearch: true,
      render: (_, r) => (
        <>
          {r.price}
          {r.mode === 'auction' && r.topBid !== null ? (
            <span style={{ color: '#52c41a' }}> → {r.topBid}</span>
          ) : null}
        </>
      ),
    },
    {
      title: '费率',
      dataIndex: 'feeBps',
      width: 70,
      hideInSearch: true,
      // 费率是挂单时的快照，改率不影响历史成交
      render: (_, r) => pct(r.feeBps),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueType: 'select',
      valueEnum: {
        listed: { text: '在售' },
        sold: { text: '已成交' },
        cancelled: { text: '已撤销' },
        expired: { text: '已过期' },
      },
      render: (_, r) => statusTag(r.status),
    },
    {
      title: '到期',
      dataIndex: 'expiresAt',
      valueType: 'dateTime',
      width: 170,
      hideInSearch: true,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 90,
      render: (_, record) => {
        if (!access.canWriteMarket) return '-';
        if (record.status !== 'listed') return '-';
        return [
          <ModalForm
            key="cancel"
            title={`强制撤单 · #${record.id}`}
            width={480}
            trigger={<a style={{ color: '#ff4d4f' }}>强制撤单</a>}
            modalProps={{ destroyOnClose: true }}
            onFinish={async (v: { reason: string }) => {
              await forceCancelListing(record.id, { reason: v.reason });
              message.success('已强制撤单');
              tableRef.current?.reload();
              return true;
            }}
          >
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="会退回标的并解冻全部出价"
              description="与玩家自己撤单走同一份实现：唯一物品从 ESCROW 退回卖家、可堆叠资产的冻结额度解冻、所有活跃出价原额退回。理由会记入审计。"
            />
            <ProFormTextArea
              name="reason"
              label="撤单理由"
              rules={[{ required: true, message: '必须填写理由，会记入审计' }]}
              placeholder="如：工单 #123 违规挂单 / 异常价格疑似站外交易"
              fieldProps={{ maxLength: 255, showCount: true, rows: 3 }}
            />
          </ModalForm>,
        ];
      },
    },
  ];

  return (
    <PageContainer header={{ title: '挂单管理' }}>
      {status ? (
        <Alert
          type={status.enabled ? 'info' : 'warning'}
          showIcon
          style={{ marginBottom: 16 }}
          message={
            status.enabled
              ? '交易市场已开放'
              : '交易市场总开关关闭中 —— 玩家的所有市场写操作都会被拒（浏览不受影响）'
          }
          description={
            <Descriptions column={3} size="small" style={{ marginTop: 8 }}>
              <Descriptions.Item label="分档开关">
                {(
                  [
                    ['recycle', '回收'],
                    ['gift', '赠送'],
                    ['listing', '寄售'],
                    ['auction', '竞价'],
                  ] as const
                ).map(([k, label]) => (
                  <Tag key={k} color={status.features[k] ? 'green' : 'default'}>
                    {label}
                    {status.features[k] ? '开' : '关'}
                  </Tag>
                ))}
              </Descriptions.Item>
              <Descriptions.Item label="手续费">
                {pct(status.feeBps)}
              </Descriptions.Item>
              <Descriptions.Item label="挂单有效期">
                {status.listingHours} 小时
              </Descriptions.Item>
              <Descriptions.Item label="回收价率">
                {pct(status.recycleRateBps)} 商店价
              </Descriptions.Item>
              <Descriptions.Item label="限价区间">
                {status.priceBand.enabled
                  ? `${pct(status.priceBand.minBps)} ~ ${pct(status.priceBand.maxBps)} 商店价`
                  : '未启用'}
              </Descriptions.Item>
              <Descriptions.Item label="风控">
                新号 {status.risk.minAccountAgeDays} 天 · 日{' '}
                {status.risk.maxTradesPerDay} 笔 / {status.risk.maxValuePerDay}
              </Descriptions.Item>
            </Descriptions>
          }
        />
      ) : null}
      <ProTable<MarketListing>
        rowKey="id"
        actionRef={tableRef}
        columns={columns}
        pagination={{ pageSize: 20 }}
        search={{ labelWidth: 'auto' }}
        request={async (params) => {
          const res = await listMarketListings({
            page: params.current ?? 1,
            pageSize: params.pageSize ?? 20,
            status: (params as any).status || undefined,
            mode: (params as any).mode || undefined,
            assetCode: (params as any).assetCode || undefined,
            sellerUserId: (params as any).sellerUserId || undefined,
          });
          return { data: res.list, total: res.total, success: true };
        }}
      />
    </PageContainer>
  );
}
