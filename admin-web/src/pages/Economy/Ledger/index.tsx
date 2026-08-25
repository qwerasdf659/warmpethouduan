import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { useRef } from 'react';
import { Button, Tag, message } from 'antd';
import {
  ModalForm,
  ProFormDigit,
  ProFormRadio,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import { grantWallet, listLedger } from '@/services/wallet';
import type { LedgerEntry } from '@/types';

const poolTag = (pool: string) =>
  pool === 'game' ? (
    <Tag color="gold">游戏币</Tag>
  ) : (
    <Tag color="purple">营销积分</Tag>
  );

export default function LedgerPage() {
  const access = useAccess();
  const tableRef = useRef<ActionType>();

  const columns: ProColumns<LedgerEntry>[] = [
    { title: '流水ID', dataIndex: 'id', width: 90, hideInSearch: true },
    {
      title: '玩家ID',
      dataIndex: 'userId',
      width: 100,
      fieldProps: { placeholder: '按玩家ID过滤' },
    },
    {
      title: '积分池',
      dataIndex: 'pool',
      width: 110,
      valueType: 'select',
      valueEnum: {
        game: { text: '游戏币' },
        marketing: { text: '营销积分' },
      },
      render: (_, r) => poolTag(r.pool),
    },
    {
      title: '变动',
      dataIndex: 'delta',
      width: 110,
      hideInSearch: true,
      render: (_, r) => (
        <span style={{ color: r.delta >= 0 ? '#52c41a' : '#ff4d4f' }}>
          {r.delta >= 0 ? `+${r.delta}` : r.delta}
        </span>
      ),
    },
    {
      title: '余额',
      dataIndex: 'balanceAfter',
      width: 100,
      hideInSearch: true,
    },
    {
      title: '原因',
      dataIndex: 'reason',
      width: 120,
      fieldProps: { placeholder: '如 interact/race' },
    },
    { title: '关联', dataIndex: 'refId', hideInSearch: true, ellipsis: true },
    { title: 'bizId', dataIndex: 'bizId', hideInSearch: true, ellipsis: true },
    {
      title: '时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 180,
      hideInSearch: true,
    },
  ];

  return (
    <PageContainer
      header={{ title: '钱包流水' }}
      extra={
        access.canWriteWallet
          ? [
              <ModalForm
                key="grant"
                title="人工发币 / 扣币"
                width={460}
                trigger={<Button type="primary">人工发币/扣币</Button>}
                modalProps={{ destroyOnClose: true }}
                initialValues={{ pool: 'game', direction: 'grant' }}
                onFinish={async (v: {
                  userId: string;
                  pool: 'game' | 'marketing';
                  direction: 'grant' | 'deduct';
                  amount: number;
                  reason?: string;
                }) => {
                  await grantWallet(v.userId, {
                    pool: v.pool,
                    direction: v.direction,
                    amount: Number(v.amount),
                    reason: v.reason,
                  });
                  message.success('操作成功');
                  tableRef.current?.reload();
                  return true;
                }}
              >
                <ProFormText
                  name="userId"
                  label="玩家ID"
                  rules={[{ required: true }]}
                />
                <ProFormRadio.Group
                  name="pool"
                  label="积分池"
                  options={[
                    { label: '游戏币', value: 'game' },
                    { label: '营销积分', value: 'marketing' },
                  ]}
                  rules={[{ required: true }]}
                />
                <ProFormRadio.Group
                  name="direction"
                  label="方向"
                  options={[
                    { label: '发放', value: 'grant' },
                    { label: '扣减', value: 'deduct' },
                  ]}
                  rules={[{ required: true }]}
                />
                <ProFormDigit
                  name="amount"
                  label="数量"
                  min={1}
                  fieldProps={{ precision: 0 }}
                  rules={[{ required: true }]}
                />
                <ProFormTextArea
                  name="reason"
                  label="备注"
                  placeholder="选填，记入审计"
                  fieldProps={{ maxLength: 255, showCount: true }}
                />
              </ModalForm>,
            ]
          : []
      }
    >
      <ProTable<LedgerEntry>
        rowKey="id"
        actionRef={tableRef}
        columns={columns}
        pagination={{ pageSize: 20 }}
        search={{ labelWidth: 'auto' }}
        request={async (params) => {
          const res = await listLedger({
            page: params.current ?? 1,
            pageSize: params.pageSize ?? 20,
            userId: (params as any).userId || undefined,
            pool: (params as any).pool || undefined,
            reason: (params as any).reason || undefined,
          });
          return { data: res.list, total: res.total, success: true };
        }}
      />
    </PageContainer>
  );
}
