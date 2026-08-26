import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { useRef, useState } from 'react';
import { Alert, Button, Tag, message } from 'antd';
import {
  ModalForm,
  ProFormDigit,
  ProFormRadio,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import {
  grantWallet,
  grantWalletBulk,
  listLedger,
  reverseTxn,
  runReconcile,
} from '@/services/wallet';
import type { LedgerEntry, ReconcileReport } from '@/types';

const poolTag = (pool: string) =>
  pool === 'game' ? (
    <Tag color="gold">游戏币</Tag>
  ) : (
    <Tag color="purple">营销积分</Tag>
  );

export default function LedgerPage() {
  const access = useAccess();
  const tableRef = useRef<ActionType>();
  const [report, setReport] = useState<ReconcileReport | null>(null);
  const [checking, setChecking] = useState(false);

  /** 立即对账：逐条校验账本的 11 项不变量。 */
  const reconcile = async () => {
    setChecking(true);
    try {
      const r = await runReconcile();
      setReport(r);
      if (r.ok) {
        message.success(
          `对账通过：${r.accountCount} 个账户、11 项不变量全部成立`,
        );
      } else {
        message.warning('对账发现异常，详见上方提示');
      }
    } finally {
      setChecking(false);
    }
  };

  const columns: ProColumns<LedgerEntry>[] = [
    { title: '流水ID', dataIndex: 'id', width: 90, hideInSearch: true },
    {
      title: '玩家ID',
      dataIndex: 'userId',
      width: 100,
      fieldProps: { placeholder: '按玩家ID过滤' },
    },
    {
      // 资产列必须有：账本重构后流水里有 31 种资产，而「积分池」只有两个值，
      // 一条 cons_snack +3 会显示成「游戏币 +3」，客服据此判断就会出错
      title: '资产',
      dataIndex: 'assetCode',
      width: 140,
      copyable: true,
      fieldProps: { placeholder: '如 game_coin / skin_tiger' },
      render: (_, r) =>
        r.assetCode === 'game_coin' || r.assetCode === 'marketing_point' ? (
          poolTag(r.pool)
        ) : (
          <Tag>{r.assetCode}</Tag>
        ),
    },
    {
      title: '积分池',
      dataIndex: 'pool',
      width: 110,
      valueType: 'select',
      hideInTable: true,
      valueEnum: {
        game: { text: '游戏币' },
        marketing: { text: '营销积分' },
      },
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
    {
      title: '操作',
      valueType: 'option',
      width: 80,
      render: (_, record) => {
        if (!access.canWriteWallet) return '-';
        return [
          <ModalForm
            key="reverse"
            title={`冲正凭证 #${record.txnId}`}
            width={460}
            trigger={<a style={{ color: '#ff4d4f' }}>冲正</a>}
            modalProps={{ destroyOnClose: true }}
            onFinish={async (v: { reason: string }) => {
              await reverseTxn(record.txnId, { reason: v.reason });
              message.success('已冲正');
              tableRef.current?.reload();
              return true;
            }}
          >
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="冲正是唯一的账务修复手段"
              description={
                <>
                  会按原凭证生成**反向分录**，原凭证一字不改（证据保留）。
                  整张凭证一起冲 —— 一笔成交含买家/卖家/手续费三条分录，
                  只冲一条会破坏守恒。同一凭证只能冲正一次；铸造凭证不可冲正。
                </>
              }
            />
            <ProFormTextArea
              name="reason"
              label="冲正原因"
              rules={[{ required: true, message: '必须填写原因，会记入审计' }]}
              placeholder="如：工单 #123 盗号追回 / 活动数值配错"
              fieldProps={{ maxLength: 255, showCount: true, rows: 3 }}
            />
          </ModalForm>,
        ];
      },
    },
  ];

  return (
    <PageContainer
      header={{ title: '钱包流水' }}
      extra={
        access.canWriteWallet
          ? [
              <Button key="reconcile" loading={checking} onClick={reconcile}>
                立即对账
              </Button>,
              <ModalForm
                key="bulk"
                title="批量发币 / 扣币"
                width={520}
                trigger={<Button>批量发放</Button>}
                modalProps={{ destroyOnClose: true }}
                initialValues={{ pool: 'marketing', direction: 'grant' }}
                onFinish={async (v: {
                  userIds: string;
                  pool: 'game' | 'marketing';
                  direction: 'grant' | 'deduct';
                  amount: number;
                  reason?: string;
                }) => {
                  const userIds = v.userIds
                    .split(/[\s,，;；]+/)
                    .map((s) => s.trim())
                    .filter(Boolean);
                  if (userIds.length === 0) {
                    message.error('请至少填一个玩家ID');
                    return false;
                  }
                  const res = await grantWalletBulk({
                    userIds,
                    pool: v.pool,
                    direction: v.direction,
                    amount: Number(v.amount),
                    reason: v.reason,
                  });
                  if (res.failed.length > 0) {
                    // 部分失败不算整批失败：把失败名单摊开让运营只补这几个
                    message.warning(
                      `成功 ${res.succeeded}/${res.total}，失败：${res.failed
                        .map((f) => `${f.userId}(${f.message})`)
                        .join('、')}`,
                      8,
                    );
                  } else {
                    message.success(`已处理 ${res.succeeded} 个玩家`);
                  }
                  tableRef.current?.reload();
                  return true;
                }}
              >
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message="单次上限 200 人"
                  description="部分失败不影响其他人；失败名单会逐条给出原因，只需补发失败的。同一次提交重发是安全的（按人幂等，不会二次入账）。"
                />
                <ProFormTextArea
                  name="userIds"
                  label="玩家ID列表"
                  rules={[{ required: true }]}
                  placeholder="一行一个，或用逗号/空格分隔"
                  fieldProps={{ rows: 6 }}
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
                  label="每人数量"
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
      {report ? (
        <Alert
          type={report.ok ? 'success' : 'error'}
          showIcon
          closable
          style={{ marginBottom: 16 }}
          onClose={() => setReport(null)}
          message={
            report.ok
              ? `对账通过：${report.accountCount} 个账户、11 项不变量全部成立`
              : `对账不平：${report.invariants.filter((i) => !i.ok).length} 项不变量被违反`
          }
          description={
            <div>
              {report.invariants
                .filter((i) => !i.ok)
                .map((i) => (
                  <div key={i.id} style={{ marginBottom: 4 }}>
                    <b>
                      #{i.id} {i.name}
                    </b>
                    ：
                    {i.count === -1
                      ? '校验 SQL 执行失败（见服务端日志）'
                      : `${i.count} 条违反`}
                    {i.samples.length > 0 ? (
                      <div style={{ color: '#8c8c8c', fontSize: 12 }}>
                        样本：{JSON.stringify(i.samples.slice(0, 3))}
                      </div>
                    ) : null}
                  </div>
                ))}
              {report.liabilities.length > 0 ? (
                <div style={{ marginTop: 8 }}>
                  待兑付负债：
                  {report.liabilities
                    .map(
                      (l) =>
                        `${l.assetCode} 发行 ${l.issued} − 兑付 ${l.burned} = ${l.outstanding}`,
                    )
                    .join('；')}
                </div>
              ) : null}
              <div style={{ marginTop: 8, color: '#8c8c8c' }}>
                系统只报告不自动纠账，避免把证据一起改掉。修复请对具体凭证走「冲正」。
              </div>
            </div>
          }
        />
      ) : null}
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
            assetCode: (params as any).assetCode || undefined,
            reason: (params as any).reason || undefined,
          });
          return { data: res.list, total: res.total, success: true };
        }}
      />
    </PageContainer>
  );
}
