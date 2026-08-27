import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { Space, Tabs, Tag } from 'antd';
import { listPvpMatches, listPvpRank } from '@/services/playexp';
import type { PvpMatchView, PvpRankView } from '@/types';

function RankTab() {
  const columns: ProColumns<PvpRankView>[] = [
    { title: '玩家', dataIndex: 'userId', width: 120, copyable: true },
    { title: '赛季', dataIndex: 'season', width: 120 },
    { title: '积分', dataIndex: 'rankPoint', width: 100 },
    { title: '胜', dataIndex: 'wins', width: 80 },
    { title: '负', dataIndex: 'losses', width: 80 },
  ];

  return (
    <ProTable<PvpRankView>
      rowKey="userId"
      columns={columns}
      search={false}
      pagination={{ pageSize: 20 }}
      request={async (params) => {
        const res = await listPvpRank({
          page: params.current ?? 1,
          pageSize: params.pageSize ?? 20,
        });
        return { data: res.list, total: res.total, success: true };
      }}
    />
  );
}

function MatchTab() {
  const columns: ProColumns<PvpMatchView>[] = [
    { title: '对局ID', dataIndex: 'id', width: 90, copyable: true },
    { title: '赛季', dataIndex: 'season', width: 110 },
    {
      title: '挑战方',
      dataIndex: 'challengerUserId',
      width: 120,
      copyable: true,
    },
    { title: '对手', dataIndex: 'opponentUserId', width: 120, copyable: true },
    { title: '赛道', dataIndex: 'trackKey', width: 120 },
    {
      title: '结果',
      dataIndex: 'win',
      width: 80,
      render: (_, r) =>
        r.win ? <Tag color="green">胜</Tag> : <Tag color="default">负</Tag>,
    },
    {
      title: '积分变动',
      dataIndex: 'rankPointDelta',
      width: 100,
      render: (_, r) => (
        <span style={{ color: r.rankPointDelta >= 0 ? '#52c41a' : '#ff4d4f' }}>
          {r.rankPointDelta >= 0 ? `+${r.rankPointDelta}` : r.rankPointDelta}
        </span>
      ),
    },
    { title: '奖励金币', dataIndex: 'rewardCoin', width: 90 },
    {
      title: '时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 170,
    },
  ];

  return (
    <ProTable<PvpMatchView>
      rowKey="id"
      columns={columns}
      search={false}
      pagination={{ pageSize: 20 }}
      request={async (params) => {
        const res = await listPvpMatches({
          page: params.current ?? 1,
          pageSize: params.pageSize ?? 20,
        });
        return { data: res.list, total: res.total, success: true };
      }}
    />
  );
}

export default function PvpPage() {
  return (
    <PageContainer header={{ title: 'PvP 天梯' }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Tabs
          items={[
            { key: 'rank', label: '天梯排名', children: <RankTab /> },
            { key: 'match', label: '对局记录', children: <MatchTab /> },
          ]}
        />
      </Space>
    </PageContainer>
  );
}
