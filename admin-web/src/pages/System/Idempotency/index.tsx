import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { useState } from 'react';
import { Alert, Empty, Tag, Typography } from 'antd';
import { queryIdempotency } from '@/services/idempotency';
import type { IdempotencyRecord } from '@/types';

/**
 * 幂等记录查询。排障场景：玩家说「点了一次却扣了两次」/「点了没反应」，
 * 用玩家ID + bizId 查这条请求到底有没有被受理过、结果是什么。
 *
 * 幂等键落在 Redis（24h TTL），按身份分两个命名空间：
 *  - 玩家端 `idem:{userId}:{bizId}`      → 主体栏填玩家 id
 *  - 后台端 `idem:admin:{adminId}:{bizId}` → 主体栏填 `admin:{adminId}`
 *
 * 查不到既可能是没发生过，也可能是已过期 —— 过期后要看钱包流水而不是这里。
 */
export default function IdempotencyPage() {
  const [empty, setEmpty] = useState(false);

  const columns: ProColumns<IdempotencyRecord>[] = [
    {
      title: '主体',
      dataIndex: 'userId',
      width: 130,
      formItemProps: { rules: [{ required: true, message: '必填' }] },
      fieldProps: { placeholder: '玩家 id，或 admin:{管理员id}' },
    },
    {
      title: 'bizId',
      dataIndex: 'bizId',
      ellipsis: true,
      copyable: true,
      fieldProps: { placeholder: '选填，留空则列出该玩家全部' },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      hideInSearch: true,
      render: (_, r) =>
        r.status === 'done' ? (
          <Tag color="green">已完成</Tag>
        ) : (
          <Tag color="orange">处理中</Tag>
        ),
    },
    {
      title: '剩余有效期',
      dataIndex: 'ttlSec',
      width: 120,
      hideInSearch: true,
      render: (_, r) =>
        r.ttlSec < 0 ? '不过期' : `${Math.floor(r.ttlSec / 60)} 分钟`,
    },
    {
      title: '上次返回结果',
      dataIndex: 'result',
      hideInSearch: true,
      render: (_, r) => (
        <Typography.Text code ellipsis style={{ maxWidth: 420 }}>
          {r.result === null ? '（处理中，无结果）' : JSON.stringify(r.result)}
        </Typography.Text>
      ),
    },
  ];

  return (
    <PageContainer
      header={{ title: '幂等记录查询' }}
      content="按主体查询写接口的幂等记录：玩家填玩家 id，后台操作填 admin:{管理员id}。记录只保留 24 小时，查不到不代表没发生过——更早的请以钱包流水为准。"
    >
      {empty ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="没有匹配的幂等记录"
          description="可能是该请求从未到达服务端，或记录已超过 24 小时被清理。"
        />
      ) : null}
      <ProTable<IdempotencyRecord>
        rowKey="key"
        columns={columns}
        pagination={false}
        search={{ labelWidth: 'auto', defaultCollapsed: false }}
        // 首屏不查：userId 是必填参数，空查会被后端 400
        manualRequest
        options={false}
        locale={{ emptyText: <Empty description="输入主体后查询" /> }}
        request={async (params) => {
          const userId = (params as { userId?: string }).userId;
          if (!userId) return { data: [], total: 0, success: true };

          const res = await queryIdempotency({
            userId,
            bizId: (params as { bizId?: string }).bizId || undefined,
          });
          // 带 bizId 时后端返回单条或 null，不带时返回数组
          const list = Array.isArray(res) ? res : res ? [res] : [];
          setEmpty(list.length === 0);
          return { data: list, total: list.length, success: true };
        }}
      />
    </PageContainer>
  );
}
