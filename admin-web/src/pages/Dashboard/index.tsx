import {
  PageContainer,
  ProCard,
  StatisticCard,
} from '@ant-design/pro-components';
import { useEffect, useState } from 'react';
import { Table } from 'antd';
import { getOverview, getTrend } from '@/services/stats';
import type { StatsOverview, TrendPoint } from '@/types';

export default function DashboardPage() {
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [points, setPoints] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [o, t] = await Promise.all([getOverview(), getTrend(7)]);
        if (!alive) return;
        setOverview(o);
        setPoints(t.points);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <PageContainer header={{ title: '数据看板' }} loading={loading && !overview}>
      <ProCard gutter={16} wrap>
        <StatisticCard
          colSpan={{ xs: 24, sm: 12, md: 6 }}
          statistic={{ title: '玩家总数', value: overview?.players.total ?? 0 }}
        />
        <StatisticCard
          colSpan={{ xs: 24, sm: 12, md: 6 }}
          statistic={{
            title: '今日新增',
            value: overview?.players.newToday ?? 0,
          }}
        />
        <StatisticCard
          colSpan={{ xs: 24, sm: 12, md: 6 }}
          statistic={{ title: '今日活跃(DAU)', value: overview?.players.dauToday ?? 0 }}
        />
        <StatisticCard
          colSpan={{ xs: 24, sm: 12, md: 6 }}
          statistic={{
            title: '封禁玩家',
            value: overview?.players.banned ?? 0,
          }}
        />
      </ProCard>

      <ProCard gutter={16} wrap style={{ marginTop: 16 }}>
        <StatisticCard
          colSpan={{ xs: 24, sm: 12, md: 6 }}
          statistic={{ title: '宠物总数', value: overview?.pets.total ?? 0 }}
        />
        <StatisticCard
          colSpan={{ xs: 24, sm: 12, md: 6 }}
          statistic={{
            title: '游戏币存量',
            value: overview?.wallet.gameCoinTotal ?? 0,
          }}
        />
        <StatisticCard
          colSpan={{ xs: 24, sm: 12, md: 6 }}
          statistic={{
            title: '营销积分存量',
            value: overview?.wallet.marketingPointTotal ?? 0,
          }}
        />
        <StatisticCard
          colSpan={{ xs: 24, sm: 12, md: 6 }}
          statistic={{
            title: '待处理兑换单',
            value: overview?.exchange.pendingOrders ?? 0,
          }}
        />
      </ProCard>

      <ProCard title="近 7 天趋势" style={{ marginTop: 16 }}>
        <Table<TrendPoint>
          rowKey="day"
          size="small"
          pagination={false}
          dataSource={points}
          columns={[
            { title: '日期', dataIndex: 'day' },
            { title: '新增用户', dataIndex: 'newUsers' },
            { title: '发币量', dataIndex: 'coinIssued' },
          ]}
        />
      </ProCard>
    </PageContainer>
  );
}
