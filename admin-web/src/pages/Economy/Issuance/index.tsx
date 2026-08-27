import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useRef, useState } from 'react';
import { Alert, Card, Col, Radio, Row, Space, Statistic, Tag } from 'antd';
import { listDailyStats } from '@/services/wallet';
import type { AssetIssuanceSummary, DailyAssetStat } from '@/types';

const DAY_OPTIONS = [7, 30, 90] as const;

const netColor = (net: number) =>
  net > 0 ? '#ff4d4f' : net < 0 ? '#52c41a' : undefined;

/**
 * 发行/销毁日报（通胀监控 + 刷币告警 + 待兑付负债）。
 *
 * 读的是每日对账物化出来的 `asset_daily_stat`，不是实时扫分录：
 * `issue`/`burn` 是单边凭证、不守恒，「本月发了多少币」在分录里是一堆正数和一堆负数
 * 混在一起，而财务要的是分开的两个口径。
 */
export default function IssuancePage() {
  const tableRef = useRef<ActionType>();
  const [days, setDays] = useState<number>(30);
  const [summary, setSummary] = useState<AssetIssuanceSummary[]>([]);

  const columns: ProColumns<DailyAssetStat>[] = [
    { title: '日期', dataIndex: 'statDay', width: 120, hideInSearch: true },
    {
      title: '资产',
      dataIndex: 'assetCode',
      width: 160,
      fieldProps: { placeholder: '如 game_coin' },
      render: (_, r) => <Tag>{r.assetCode}</Tag>,
    },
    {
      title: '原因',
      dataIndex: 'reason',
      width: 140,
      fieldProps: { placeholder: '如 interact/gacha' },
    },
    {
      title: '发行',
      dataIndex: 'issued',
      width: 120,
      hideInSearch: true,
      render: (_, r) => (r.issued ? `+${r.issued}` : '0'),
    },
    {
      title: '销毁',
      dataIndex: 'burned',
      width: 120,
      hideInSearch: true,
      render: (_, r) => (r.burned ? `−${r.burned}` : '0'),
    },
    {
      title: '净发行',
      dataIndex: 'net',
      width: 120,
      hideInSearch: true,
      render: (_, r) => (
        <span style={{ color: netColor(r.net), fontWeight: 500 }}>
          {r.net > 0 ? `+${r.net}` : r.net}
        </span>
      ),
    },
  ];

  return (
    <PageContainer
      header={{ title: '发行日报' }}
      extra={[
        <Space key="days">
          <span>统计窗口</span>
          <Radio.Group
            value={days}
            onChange={(e) => {
              setDays(Number(e.target.value));
              tableRef.current?.reload();
            }}
            options={DAY_OPTIONS.map((d) => ({ label: `${d} 日`, value: d }))}
            optionType="button"
          />
        </Space>,
      ]}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="数据来自每日 04:10 对账作业的物化结果"
        description={
          <>
            **净发行持续为正即通胀**：产出多于回收，币量在膨胀。
            某个「原因」的发行量突增通常意味着两件事之一 ——
            玩法数值配错，或者有人在刷。
            <br />
            当天的数据要等次日 04:10 对账跑完才会出现；
            想立刻看可以在「钱包流水」页点「立即对账」，它会顺带重算最近 3 天。
          </>
        }
      />

      {summary.length > 0 ? (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          {summary.slice(0, 4).map((s) => (
            <Col key={s.assetCode} span={6}>
              <Card size="small">
                <Statistic
                  title={`${s.assetCode} 净发行（近 ${days} 日）`}
                  value={s.net}
                  valueStyle={{ color: netColor(s.net) }}
                  prefix={s.net > 0 ? '+' : ''}
                />
                <div style={{ color: '#8c8c8c', fontSize: 12 }}>
                  发行 {s.issued} · 销毁 {s.burned}
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      ) : null}

      <ProTable<DailyAssetStat>
        rowKey={(r) => `${r.statDay}-${r.assetCode}-${r.reason}`}
        actionRef={tableRef}
        columns={columns}
        search={{ labelWidth: 'auto' }}
        pagination={{ pageSize: 30 }}
        request={async (params) => {
          const res = await listDailyStats({
            days,
            assetCode: (params as any).assetCode || undefined,
            reason: (params as any).reason || undefined,
          });
          setSummary(res.summary);
          return { data: res.list, total: res.list.length, success: true };
        }}
      />
    </PageContainer>
  );
}
