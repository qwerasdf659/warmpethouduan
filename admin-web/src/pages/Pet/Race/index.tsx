import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { Alert, Tag, Typography } from 'antd';
import { listRaceRecords } from '@/services/gameplay';
import type { RaceRecordView } from '@/types';

const GRADE_COLOR: Record<string, string> = {
  S: 'gold',
  A: 'green',
  B: 'blue',
  C: 'default',
};

/**
 * 赛跑记录。
 *
 * 赛跑是两阶段的：start 落 pending（名次此时已由服务端算定），settle 才发奖。
 * 所以长期停在 pending 的行就是「跑完没发奖」的掉单，用状态筛一下就能捞出来。
 */
export default function RacePage() {
  const columns: ProColumns<RaceRecordView>[] = [
    { title: '记录ID', dataIndex: 'id', width: 90, hideInSearch: true },
    { title: '玩家ID', dataIndex: 'userId', width: 100, copyable: true },
    {
      title: '宠物ID',
      dataIndex: 'petId',
      width: 90,
      hideInSearch: true,
    },
    { title: '赛道', dataIndex: 'trackKey', width: 130 },
    {
      title: '名次',
      dataIndex: 'rank',
      width: 90,
      hideInSearch: true,
      render: (_, r) => `${r.rank} / ${r.totalRacers}`,
    },
    {
      title: '评级',
      dataIndex: 'grade',
      width: 80,
      hideInSearch: true,
      render: (_, r) =>
        r.grade ? <Tag color={GRADE_COLOR[r.grade]}>{r.grade}</Tag> : '-',
    },
    {
      title: '完成用时',
      dataIndex: 'finishTime',
      width: 110,
      hideInSearch: true,
      render: (_, r) => (r.finishTime === null ? '-' : `${r.finishTime}s`),
    },
    {
      title: '对手来源',
      dataIndex: 'ghostSource',
      width: 100,
      hideInSearch: true,
      render: (_, r) => r.ghostSource ?? '-',
    },
    {
      title: '奖励',
      dataIndex: 'rewardCoin',
      width: 120,
      hideInSearch: true,
      align: 'right',
      render: (_, r) => (
        <span>
          {r.rewardCoin.toLocaleString('zh-CN')}
          {r.rewardDoubled ? <Tag color="gold">双倍</Tag> : null}
        </span>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      valueType: 'select',
      valueEnum: {
        pending: { text: '未结算' },
        settled: { text: '已结算' },
      },
      render: (_, r) =>
        r.status === 'settled' ? (
          <Tag color="success">已结算</Tag>
        ) : (
          <Tag color="error">未结算</Tag>
        ),
    },
    {
      title: '结算时间',
      dataIndex: 'settledAt',
      valueType: 'dateTime',
      hideInSearch: true,
      width: 170,
    },
    {
      title: '开始时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      hideInSearch: true,
      width: 170,
    },
  ];

  return (
    <PageContainer header={{ title: '赛跑记录' }}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="「未结算」= 跑完但没发奖"
        description={
          <Typography.Text>
            赛跑分两步：开始时名次已由服务端算定并落
            pending，玩家看完动画后领奖才置为
            settled。长时间停在「未结算」的记录即掉单，可用状态筛选批量核对。
          </Typography.Text>
        }
      />
      <ProTable<RaceRecordView>
        rowKey="id"
        headerTitle="赛跑记录"
        cardBordered
        columns={columns}
        scroll={{ x: 'max-content' }}
        search={{ labelWidth: 'auto' }}
        pagination={{
          pageSize: 20,
          showTotal: (t) => `共 ${t.toLocaleString('zh-CN')} 条`,
        }}
        request={async (params) => {
          const res = await listRaceRecords({
            page: params.current ?? 1,
            pageSize: params.pageSize ?? 20,
            userId: params.userId,
            status: params.status,
            trackKey: params.trackKey,
          });
          return { data: res.list, total: res.total, success: true };
        }}
      />
    </PageContainer>
  );
}
