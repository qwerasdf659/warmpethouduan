import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { Space, Tag, Tooltip, Typography } from 'antd';
import { listGachaDraws, listGachaStates } from '@/services/gameplay';
import type { GachaDrawView, GachaPrize, GachaStateView } from '@/types';

/**
 * 扭蛋记录。
 *
 * 存在的理由是「我抽了 80 次没出金」这类工单：上面是保底进度（当前攒到第几发），
 * 下面是逐次产出。两张表放同一页，客服不用在菜单之间来回跳。
 */
export default function GachaPage() {
  const stateColumns: ProColumns<GachaStateView>[] = [
    { title: '玩家ID', dataIndex: 'userId', width: 100, copyable: true },
    { title: '池子', dataIndex: 'poolKey', hideInSearch: true },
    {
      title: '当前保底计数',
      dataIndex: 'pity',
      hideInSearch: true,
      width: 130,
      sorter: (a, b) => a.pity - b.pity,
      render: (_, r) => <Typography.Text strong>{r.pity}</Typography.Text>,
    },
    {
      title: '累计抽数',
      dataIndex: 'totalDraws',
      hideInSearch: true,
      width: 110,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      valueType: 'dateTime',
      hideInSearch: true,
      width: 170,
    },
  ];

  const drawColumns: ProColumns<GachaDrawView>[] = [
    { title: '记录ID', dataIndex: 'id', width: 90, hideInSearch: true },
    { title: '玩家ID', dataIndex: 'userId', width: 100, copyable: true },
    { title: '池子', dataIndex: 'poolKey', width: 140 },
    {
      title: '抽数',
      dataIndex: 'times',
      width: 80,
      hideInSearch: true,
    },
    {
      title: '花费',
      dataIndex: 'cost',
      width: 120,
      hideInSearch: true,
      render: (_, r) => `${r.cost.toLocaleString('zh-CN')} ${r.assetCode}`,
    },
    {
      title: '只看出货',
      dataIndex: 'filter',
      hideInTable: true,
      valueType: 'select',
      valueEnum: { rare: { text: '仅含稀有奖励' } },
    },
    {
      title: '产出',
      dataIndex: 'prizes',
      hideInSearch: true,
      render: (_, r) => <Prizes prizes={r.prizes} />,
    },
    {
      title: '已发放',
      dataIndex: 'delivered',
      width: 90,
      hideInSearch: true,
      render: (_, r) =>
        r.delivered ? (
          <Tag color="success">已发放</Tag>
        ) : (
          // 未发放 = 抽到了但奖励没进背包，是要立刻查的掉单
          <Tag color="error">未发放</Tag>
        ),
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      hideInSearch: true,
      width: 170,
    },
  ];

  return (
    <PageContainer
      header={{ title: '扭蛋记录' }}
      content="上表为各玩家在每个池子的保底进度，下表为逐次抽取的产出明细。「未发放」表示抽到了但奖励没进背包，需要立刻排查。"
    >
      <ProTable<GachaStateView>
        rowKey="id"
        headerTitle="保底进度"
        cardBordered
        columns={stateColumns}
        search={{ labelWidth: 'auto' }}
        pagination={{ pageSize: 10 }}
        request={async (params) => {
          const res = await listGachaStates({
            page: params.current ?? 1,
            pageSize: params.pageSize ?? 10,
            userId: params.userId,
            poolKey: params.poolKey,
          });
          return { data: res.list, total: res.total, success: true };
        }}
      />

      <ProTable<GachaDrawView>
        rowKey="id"
        headerTitle="抽取记录"
        cardBordered
        style={{ marginTop: 16 }}
        columns={drawColumns}
        scroll={{ x: 'max-content' }}
        search={{ labelWidth: 'auto' }}
        pagination={{ pageSize: 20 }}
        request={async (params) => {
          const res = await listGachaDraws({
            page: params.current ?? 1,
            pageSize: params.pageSize ?? 20,
            userId: params.userId,
            poolKey: params.poolKey,
            filter: params.filter,
          });
          return { data: res.list, total: res.total, success: true };
        }}
      />
    </PageContainer>
  );
}

/**
 * 一抽的产出。稀有项高亮 —— 客服扫这一列就是在找「到底出没出」。
 *
 * 十连里同一个奖励会出现多次，逐条铺开会把单元格撑爆，所以按「奖励 + 是否
 * 重复转换」合并计数。这两项要分开算：同一件东西第一份进背包、第二份转成
 * 碎片，是玩家最容易来问的差别。
 */
function Prizes({ prizes }: { prizes: GachaDrawView['prizes'] }) {
  if (!prizes?.length)
    return <Typography.Text type="secondary">-</Typography.Text>;

  const merged = new Map<string, GachaPrize>();
  for (const p of prizes) {
    const key = `${p.entryKey}:${p.converted}`;
    const hit = merged.get(key);
    if (hit) hit.qty += p.qty;
    else merged.set(key, { ...p });
  }

  return (
    <Space size={4} wrap>
      {[...merged].map(([key, p]) => (
        <Tooltip
          key={key}
          title={`${p.assetCode} ×${p.qty}${p.converted ? '（重复转换）' : ''}`}
        >
          <Tag color={p.rare ? 'gold' : 'default'}>
            {p.name}
            {p.qty > 1 ? ` ×${p.qty}` : ''}
          </Tag>
        </Tooltip>
      ))}
    </Space>
  );
}
