import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { Tag } from 'antd';
import { listMinigameSessions } from '@/services/playexp';
import type { MinigameSessionView } from '@/types';

const statusTag = (s: string) => {
  const map: Record<string, { color: string; text: string }> = {
    playing: { color: 'blue', text: '进行中' },
    settled: { color: 'green', text: '已结算' },
    abandoned: { color: 'default', text: '已放弃' },
  };
  const m = map[s] ?? { color: 'default', text: s };
  return <Tag color={m.color}>{m.text}</Tag>;
};

export default function MinigamePage() {
  const columns: ProColumns<MinigameSessionView>[] = [
    { title: '对局ID', dataIndex: 'id', width: 90, copyable: true },
    { title: '玩家', dataIndex: 'userId', width: 120, copyable: true },
    { title: '游戏', dataIndex: 'gameKey', width: 140 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (_, r) => statusTag(r.status),
    },
    { title: '得分', dataIndex: 'score', width: 90 },
    { title: '奖励金币', dataIndex: 'rewardCoin', width: 90 },
    {
      title: '结算时间',
      dataIndex: 'settledAt',
      valueType: 'dateTime',
      width: 170,
    },
  ];

  return (
    <PageContainer header={{ title: '小游戏对局' }}>
      <ProTable<MinigameSessionView>
        rowKey="id"
        columns={columns}
        search={false}
        pagination={{ pageSize: 20 }}
        request={async (params) => {
          const res = await listMinigameSessions({
            page: params.current ?? 1,
            pageSize: params.pageSize ?? 20,
          });
          return { data: res.list, total: res.total, success: true };
        }}
      />
    </PageContainer>
  );
}
