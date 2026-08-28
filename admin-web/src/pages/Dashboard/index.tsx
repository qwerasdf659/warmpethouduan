import {
  PageContainer,
  ProCard,
  StatisticCard,
} from '@ant-design/pro-components';
import { DualAxes, Tiny } from '@ant-design/plots';
import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { Empty, Segmented, Space, Typography, theme } from 'antd';
import { getOverview, getTrend } from '@/services/stats';
import type { StatsOverview, TrendPoint } from '@/types';

/** 发币量固定用青色，不跟随主色：两条曲线必须始终能分辨，而主色是运营可改的。 */
const COIN_SERIES_COLOR = '#0D9488';

const RANGES = [
  { label: '7 天', value: 7 },
  { label: '14 天', value: 14 },
  { label: '30 天', value: 30 },
];

/** 20260828 → 08-28。图表横轴上完整年份没有信息量，只会挤掉刻度。 */
function shortDay(day: string) {
  return day.length === 8 ? `${day.slice(4, 6)}-${day.slice(6, 8)}` : day;
}

/** 发币量动辄七位数，轴上铺一排零会把绘图区挤没。按量级降到「万」。 */
function compactNum(v: number) {
  if (Math.abs(v) >= 10_000) return `${+(v / 10_000).toFixed(1)}万`;
  return String(v);
}

export default function DashboardPage() {
  const { token } = theme.useToken();
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [points, setPoints] = useState<TrendPoint[]>([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [trendLoading, setTrendLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    getOverview()
      .then((o) => {
        if (alive) setOverview(o);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setTrendLoading(true);
    getTrend(days)
      .then((t) => {
        if (alive) setPoints(t.points);
      })
      .finally(() => {
        if (alive) setTrendLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [days]);

  /**
   * 今日 / 昨日新增。
   *
   * 直接从趋势数据的最后两天取，不另开接口：`/admin/stats/trend` 本来就是按
   * 东八区自然日分好的，最后一个点就是今天。overview 里的 newToday 与它同源。
   */
  const todayNew = points.at(-1)?.newUsers;
  const prevNew = points.length >= 2 ? points.at(-2)?.newUsers : undefined;

  const chartData = points.map((p) => ({ ...p, label: shortDay(p.day) }));
  const sparkline = points.map((p, i) => ({ i, v: p.newUsers }));
  const hasTrend = points.some((p) => p.newUsers > 0 || p.coinIssued > 0);

  const dualAxesConfig = {
    height: 320,
    xField: 'label',
    legend: false as const,
    data: chartData,
    children: [
      {
        type: 'area',
        yField: 'newUsers',
        shapeField: 'smooth',
        // 描边直接写在 area 的 style 上，不用 `line: {...}` 子项：后者会额外生成
        // 一层 mark，DualAxes 给每层都配一根 y 轴，左边就会叠出两条刻度。
        style: {
          fill: token.colorPrimary,
          fillOpacity: 0.15,
          stroke: token.colorPrimary,
          lineWidth: 2,
        },
        // 不给 y 轴标题：中文标题在 G2 里是竖排的，挤在绘图区边缘既难读又占宽度。
        // 「哪条线看哪根轴」改由上方图例的「左轴/右轴」说明。
        axis: { y: { labelFormatter: compactNum } },
      },
      {
        type: 'line',
        yField: 'coinIssued',
        shapeField: 'smooth',
        style: { stroke: COIN_SERIES_COLOR, lineWidth: 2 },
        axis: {
          y: { position: 'right', labelFormatter: compactNum },
        },
      },
    ],
  };

  return (
    <PageContainer
      header={{ title: '数据看板' }}
      loading={loading && !overview}
      extra={[
        <Segmented
          key="range"
          value={days}
          options={RANGES}
          onChange={(v) => setDays(v as number)}
        />,
      ]}
    >
      <ProCard gutter={16} wrap ghost>
        <StatisticCard
          colSpan={{ xs: 24, sm: 12, xl: 6 }}
          statistic={{ title: '玩家总数', value: overview?.players.total ?? 0 }}
        />
        <StatisticCard
          colSpan={{ xs: 24, sm: 12, xl: 6 }}
          statistic={{
            title: '今日新增',
            value: overview?.players.newToday ?? 0,
            description: <Delta current={todayNew} previous={prevNew} />,
          }}
          chart={
            sparkline.length > 1 ? (
              <Tiny.Area
                autoFit={false}
                width={90}
                height={44}
                data={sparkline}
                xField="i"
                yField="v"
                shapeField="smooth"
                style={{ fill: token.colorPrimary, fillOpacity: 0.18 }}
                line={{ style: { stroke: token.colorPrimary, lineWidth: 2 } }}
              />
            ) : undefined
          }
          chartPlacement="right"
        />
        <StatisticCard
          colSpan={{ xs: 24, sm: 12, xl: 6 }}
          statistic={{
            title: '今日活跃 (DAU)',
            value: overview?.players.dauToday ?? 0,
            // last_seen_at 只保留最近一次活跃，昨日 DAU 无法回算，因此不给环比
            description: (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                按当日活跃去重
              </Typography.Text>
            ),
          }}
        />
        <StatisticCard
          colSpan={{ xs: 24, sm: 12, xl: 6 }}
          statistic={{
            title: '封禁玩家',
            value: overview?.players.banned ?? 0,
            valueStyle: overview?.players.banned
              ? { color: token.colorError }
              : undefined,
          }}
        />
      </ProCard>

      <ProCard gutter={16} wrap ghost style={{ marginTop: 16 }}>
        <StatisticCard
          colSpan={{ xs: 24, sm: 12, xl: 6 }}
          statistic={{ title: '宠物总数', value: overview?.pets.total ?? 0 }}
        />
        <StatisticCard
          colSpan={{ xs: 24, sm: 12, xl: 6 }}
          statistic={{
            title: '游戏币存量',
            value: overview?.wallet.gameCoinTotal ?? 0,
            description: (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                含挂单冻结
              </Typography.Text>
            ),
          }}
        />
        <StatisticCard
          colSpan={{ xs: 24, sm: 12, xl: 6 }}
          statistic={{
            title: '营销积分存量',
            value: overview?.wallet.marketingPointTotal ?? 0,
            description: (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                含挂单冻结
              </Typography.Text>
            ),
          }}
        />
        <StatisticCard
          colSpan={{ xs: 24, sm: 12, xl: 6 }}
          statistic={{
            title: '待处理兑换单',
            value: overview?.exchange.pendingOrders ?? 0,
            // 有积压才染色：常态是 0，长期挂着橙色数字会让运营对它脱敏
            valueStyle: overview?.exchange.pendingOrders
              ? { color: token.colorWarning }
              : undefined,
          }}
        />
      </ProCard>

      <ProCard
        title={`近 ${days} 天趋势`}
        style={{ marginTop: 16 }}
        loading={trendLoading && !points.length}
        extra={
          <Space size={16}>
            <LegendDot color={token.colorPrimary} text="新增用户（左轴）" />
            <LegendDot color={COIN_SERIES_COLOR} text="发币量（右轴）" />
          </Space>
        }
      >
        {hasTrend ? (
          // 用展开而不是写 children={...}：这里的 children 是 G2 的「子图层配置」，
          // 跟 React children 同名但语义无关，写成 JSX 属性会被 lint 判成误用。
          <DualAxes {...dualAxesConfig} />
        ) : (
          <Empty
            style={{ padding: '48px 0' }}
            description={`近 ${days} 天没有新增用户与发币记录`}
          />
        )}
      </ProCard>
    </PageContainer>
  );
}

function LegendDot({ color, text }: { color: string; text: string }) {
  return (
    <Space size={6}>
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
        }}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {text}
      </Typography.Text>
    </Space>
  );
}

/**
 * 环比昨日。
 *
 * 昨日为 0 时不显示百分比：从 0 涨到任何数都是「+∞%」，写成 +100% 是错的，
 * 这种时候直接说增减了多少个更有意义。
 */
function Delta({ current, previous }: { current?: number; previous?: number }) {
  const { token } = theme.useToken();
  if (current === undefined || previous === undefined) return null;

  const diff = current - previous;
  if (diff === 0) {
    return (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        与昨日持平
      </Typography.Text>
    );
  }

  const up = diff > 0;
  const color = up ? token.colorSuccess : token.colorError;
  const text =
    previous === 0
      ? `${up ? '+' : ''}${diff}`
      : `${up ? '+' : ''}${((diff / previous) * 100).toFixed(1)}%`;

  return (
    <Typography.Text style={{ fontSize: 12, color }}>
      {up ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {text}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {' '}
        较昨日
      </Typography.Text>
    </Typography.Text>
  );
}
