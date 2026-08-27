import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useRef, useState } from 'react';
import { Alert, Radio, Space, Tag } from 'antd';
import { listNetFlow } from '@/services/market';
import type { NetFlowAlert } from '@/types';

const DAY_OPTIONS = [7, 14, 30] as const;

/**
 * R4 单向净流出复核清单。
 *
 * 刻意不做「一键封号」：`net_outflow` 长期为正高度可疑（小号供养大号是这个形状），
 * 但情侣号、师徒、公会内部支援也完全是这个形状。自动处置会误伤，
 * 所以这一页的产出是**线索**，处置要人看过上下文再决定。
 */
export default function NetFlowPage() {
  const tableRef = useRef<ActionType>();
  const [days, setDays] = useState<number>(7);

  const columns: ProColumns<NetFlowAlert>[] = [
    {
      title: '玩家ID',
      dataIndex: 'userId',
      width: 120,
      render: (_, r) => r.userId ?? <Tag>系统账户</Tag>,
    },
    { title: '账户ID', dataIndex: 'accountId', width: 120 },
    {
      title: `近 ${days} 日净流出`,
      dataIndex: 'netOutflow',
      // 数值越大越可疑；排序由后端按净流出降序给出，这里不再前端排
      render: (_, r) => (
        <span style={{ color: '#ff4d4f', fontWeight: 500 }}>
          {r.netOutflow}
        </span>
      ),
    },
  ];

  return (
    <PageContainer
      header={{ title: '净流出风控' }}
      extra={[
        <Space key="days">
          <span>统计窗口</span>
          <Radio.Group
            value={days}
            onChange={(e) => {
              setDays(Number(e.target.value));
              tableRef.current?.reload();
            }}
            options={DAY_OPTIONS.map((d) => ({
              label: `${d} 日`,
              value: d,
            }))}
            optionType="button"
          />
        </Space>,
      ]}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="这是复核线索，不是证据"
        description={
          <>
            净流出 = 送出 − 收到。长期为正是「小号供养大号」的典型形状，
            但情侣号、师徒关系、公会内部支援也完全一样。
            因此本页只列清单、不提供任何自动处置 —— 判断要结合登录
            IP、设备、注册时间一起看。
            <br />
            服务端每天 04:20 也会把同一份清单打进日志（`market-netflow` 作业）。
          </>
        }
      />
      <ProTable<NetFlowAlert>
        rowKey="accountId"
        actionRef={tableRef}
        columns={columns}
        search={false}
        pagination={false}
        request={async () => {
          const res = await listNetFlow({ days });
          return { data: res.list, total: res.list.length, success: true };
        }}
      />
    </PageContainer>
  );
}
