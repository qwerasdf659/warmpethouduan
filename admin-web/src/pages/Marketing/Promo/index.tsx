import {
  PageContainer,
  ProTable,
  ModalForm,
  ProFormText,
  ProFormDigit,
  ProFormSelect,
  ProFormDateTimePicker,
  ProFormTextArea,
} from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Access, useAccess } from '@umijs/max';
import {
  Alert,
  Button,
  Modal,
  Popconfirm,
  Space,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import { useRef, useState } from 'react';
import {
  createBatch,
  listBatches,
  listCodes,
  listRedemptions,
  toggleBatch,
  toggleCode,
} from '@/services/promo';
import type {
  PromoBatchSummary,
  PromoCodeView,
  PromoRedemptionView,
} from '@/types';

/**
 * 兑换码管理。
 *
 * 为什么这一页重要：营销积分**没有任何游戏内产出途径**（设计如此，它代表线下
 * 消费/异业触点），兑换中心的实物商品全部以营销积分计价。因此这里是玩家能拿到
 * 营销积分的唯一入口 —— 不发码，兑换中心对玩家就是摆设。
 *
 * 生码后明文只在创建响应里完整给一次，之后也能在「码明细」里查回来 ——
 * 它不是密码，运营需要能核对、能补发。
 */

/** 生码结果弹窗：明文一次性给全量，支持复制去印物料。 */
function CodesResultModal(props: {
  open: boolean;
  batch: string;
  codes: string[];
  onClose: () => void;
}) {
  const text = props.codes.join('\n');
  return (
    <Modal
      open={props.open}
      title={`批次 ${props.batch} 生成 ${props.codes.length} 个码`}
      onCancel={props.onClose}
      onOk={props.onClose}
      width={520}
    >
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message="请先复制留档"
        description="码可在「码明细」页随时查回，但一次性复制去做物料更省事。"
      />
      <Typography.Paragraph
        copyable={{ text }}
        style={{
          maxHeight: 300,
          overflow: 'auto',
          background: '#fafafa',
          padding: 12,
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
        }}
      >
        {text}
      </Typography.Paragraph>
    </Modal>
  );
}

function BatchTab() {
  const access = useAccess();
  const ref = useRef<ActionType>();
  const [result, setResult] = useState<{ batch: string; codes: string[] }>();

  const columns: ProColumns<PromoBatchSummary>[] = [
    { title: '批次', dataIndex: 'batch', copyable: true },
    {
      title: '账户池',
      dataIndex: 'pool',
      width: 100,
      render: (_, r) =>
        r.pool === 'marketing' ? (
          <Tag color="gold">营销积分</Tag>
        ) : (
          <Tag color="blue">游戏币</Tag>
        ),
    },
    {
      title: '码数量',
      dataIndex: 'codes',
      width: 100,
      render: (_, r) => `${r.enabledCodes} / ${r.codes}`,
      tooltip: '启用中 / 总数',
    },
    {
      title: '核销进度',
      dataIndex: 'usedUses',
      width: 130,
      render: (_, r) => `${r.usedUses} / ${r.totalUses}`,
      tooltip: '已占用次数 / 可用次数总和',
    },
    {
      title: '入账记录',
      dataIndex: 'redemptions',
      width: 110,
      render: (_, r) => (
        // 两者不等 = 有「占了次数但入账失败」的记录，必须让运营看见而不是算平
        <span
          style={{ color: r.redemptions === r.usedUses ? undefined : 'red' }}
        >
          {r.redemptions}
        </span>
      ),
      tooltip: '正常应与「已占用次数」相等；不等说明有占用了次数但未入账的记录',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 170,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 160,
      render: (_, r) => [
        <Access key="off" accessible={access.canWritePromo}>
          <Popconfirm
            title="停用整批？"
            description="已核销记录不受影响，只是之后不能再兑。"
            onConfirm={async () => {
              const res = await toggleBatch(r.batch, false);
              message.success(`已停用 ${res.affected} 个码`);
              ref.current?.reload();
            }}
          >
            <a>停用整批</a>
          </Popconfirm>
        </Access>,
        <Access key="on" accessible={access.canWritePromo}>
          <a
            onClick={async () => {
              const res = await toggleBatch(r.batch, true);
              message.success(`已启用 ${res.affected} 个码`);
              ref.current?.reload();
            }}
          >
            启用整批
          </a>
        </Access>,
      ],
    },
  ];

  return (
    <>
      <ProTable<PromoBatchSummary>
        rowKey="batch"
        actionRef={ref}
        columns={columns}
        search={false}
        pagination={false}
        toolBarRender={() => [
          <Access key="new" accessible={access.canWritePromo}>
            <ModalForm
              title="生成兑换码批次"
              trigger={<Button type="primary">生成新批次</Button>}
              width={480}
              modalProps={{ destroyOnClose: true }}
              onFinish={async (v: {
                batch: string;
                pool: 'game' | 'marketing';
                amount: number;
                count: number;
                maxUses?: number;
                expiresAt?: string;
                remark?: string;
              }) => {
                const res = await createBatch(v);
                if (res.created < v.count) {
                  message.warning(
                    `实际生成 ${res.created}/${v.count}（撞码重试耗尽）`,
                  );
                } else {
                  message.success(`已生成 ${res.created} 个码`);
                }
                setResult({ batch: res.batch, codes: res.codes });
                ref.current?.reload();
                return true;
              }}
            >
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="两种形态别混用"
                description="线下印码：数量 5000、每码可用次数 1（五千张各用一次）。合作发一个码：数量 1、每码可用次数 5000（同一个码五千人可用，每人仍只能一次）。"
              />
              <ProFormText
                name="batch"
                label="批次名"
                rules={[{ required: true }]}
                extra="用于归档与整批停用，建议带日期与渠道，如 20260826-门店A"
              />
              <ProFormSelect
                name="pool"
                label="账户池"
                initialValue="marketing"
                options={[
                  { label: '营销积分（可兑实物）', value: 'marketing' },
                  { label: '游戏币', value: 'game' },
                ]}
                rules={[{ required: true }]}
              />
              <ProFormDigit
                name="amount"
                label="每次核销面额"
                min={1}
                max={1000000}
                rules={[{ required: true }]}
              />
              <ProFormDigit
                name="count"
                label="生成码数量"
                min={1}
                max={5000}
                initialValue={1}
                rules={[{ required: true }]}
                extra="单次上限 5000，更多请分批生成"
              />
              <ProFormDigit
                name="maxUses"
                label="每码可用次数"
                min={1}
                initialValue={1}
                extra="同一玩家对同一个码始终只能核销一次，与此值无关"
              />
              <ProFormDateTimePicker
                name="expiresAt"
                label="过期时间"
                extra="留空 = 永不过期"
                transform={(v: string) =>
                  v ? { expiresAt: new Date(v).toISOString() } : {}
                }
              />
              <ProFormTextArea name="remark" label="备注" />
            </ModalForm>
          </Access>,
        ]}
        request={async () => {
          const res = await listBatches();
          return { data: res.list, total: res.list.length, success: true };
        }}
      />
      <CodesResultModal
        open={!!result}
        batch={result?.batch ?? ''}
        codes={result?.codes ?? []}
        onClose={() => setResult(undefined)}
      />
    </>
  );
}

function CodeTab() {
  const access = useAccess();
  const ref = useRef<ActionType>();

  const columns: ProColumns<PromoCodeView>[] = [
    { title: '兑换码', dataIndex: 'code', copyable: true, width: 150 },
    { title: '批次', dataIndex: 'batch', width: 160 },
    {
      title: '账户池',
      dataIndex: 'pool',
      width: 100,
      hideInSearch: true,
      render: (_, r) =>
        r.pool === 'marketing' ? (
          <Tag color="gold">营销积分</Tag>
        ) : (
          <Tag color="blue">游戏币</Tag>
        ),
    },
    { title: '面额', dataIndex: 'amount', width: 90, hideInSearch: true },
    {
      title: '核销',
      dataIndex: 'usedCount',
      width: 90,
      hideInSearch: true,
      render: (_, r) => `${r.usedCount} / ${r.maxUses}`,
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 100,
      valueType: 'select',
      valueEnum: {
        true: { text: '启用中' },
        false: { text: '已停用' },
      },
      render: (_, r) =>
        r.enabled ? (
          <Tag color="green">启用中</Tag>
        ) : (
          <Tag color="default">已停用</Tag>
        ),
    },
    {
      title: '过期时间',
      dataIndex: 'expiresAt',
      valueType: 'dateTime',
      width: 170,
      hideInSearch: true,
      render: (_, r) => (r.expiresAt ? r.expiresAt : '永不过期'),
    },
    {
      title: '备注',
      dataIndex: 'remark',
      ellipsis: true,
      hideInSearch: true,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 90,
      render: (_, r) => [
        <Access key="t" accessible={access.canWritePromo}>
          <a
            onClick={async () => {
              await toggleCode(r.id, !r.enabled);
              message.success(r.enabled ? '已停用' : '已启用');
              ref.current?.reload();
            }}
          >
            {r.enabled ? '停用' : '启用'}
          </a>
        </Access>,
      ],
    },
  ];

  return (
    <ProTable<PromoCodeView>
      rowKey="id"
      actionRef={ref}
      columns={columns}
      search={{ labelWidth: 'auto' }}
      request={async (params) => {
        const p = params as {
          current?: number;
          pageSize?: number;
          batch?: string;
          code?: string;
          enabled?: string;
        };
        const res = await listCodes({
          page: p.current ?? 1,
          pageSize: p.pageSize ?? 20,
          batch: p.batch || undefined,
          code: p.code || undefined,
          enabled: p.enabled === undefined ? undefined : p.enabled === 'true',
        });
        return { data: res.list, total: res.total, success: true };
      }}
    />
  );
}

function RedemptionTab() {
  const columns: ProColumns<PromoRedemptionView>[] = [
    { title: '玩家ID', dataIndex: 'userId', width: 100, copyable: true },
    { title: '兑换码', dataIndex: 'code', width: 150, hideInSearch: true },
    { title: '批次', dataIndex: 'batch', width: 160 },
    {
      title: '账户池',
      dataIndex: 'pool',
      width: 100,
      hideInSearch: true,
      render: (_, r) =>
        r.pool === 'marketing' ? (
          <Tag color="gold">营销积分</Tag>
        ) : (
          <Tag color="blue">游戏币</Tag>
        ),
    },
    { title: '入账面额', dataIndex: 'amount', width: 100, hideInSearch: true },
    {
      title: '核销时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 170,
      hideInSearch: true,
    },
  ];

  return (
    <ProTable<PromoRedemptionView>
      rowKey="id"
      columns={columns}
      search={{ labelWidth: 'auto' }}
      request={async (params) => {
        const p = params as {
          current?: number;
          pageSize?: number;
          userId?: string;
          batch?: string;
        };
        const res = await listRedemptions({
          page: p.current ?? 1,
          pageSize: p.pageSize ?? 20,
          userId: p.userId || undefined,
          batch: p.batch || undefined,
        });
        return { data: res.list, total: res.total, success: true };
      }}
    />
  );
}

export default function PromoPage() {
  return (
    <PageContainer
      header={{ title: '兑换码' }}
      content="营销积分没有任何游戏内产出途径（设计如此），发码是玩家拿到营销积分的唯一入口。不发码，兑换中心的实物商品玩家就兑不动。"
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Tabs
          items={[
            { key: 'batch', label: '批次汇总', children: <BatchTab /> },
            { key: 'code', label: '码明细', children: <CodeTab /> },
            {
              key: 'redemption',
              label: '核销记录',
              children: <RedemptionTab />,
            },
          ]}
        />
      </Space>
    </PageContainer>
  );
}
