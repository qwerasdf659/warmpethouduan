import {
  ModalForm,
  PageContainer,
  ProDescriptions,
  ProForm,
  ProFormDigit,
  ProFormRadio,
  ProFormSelect,
  ProFormTextArea,
  ProTable,
} from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { useEffect, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Drawer,
  Empty,
  Popconfirm,
  Progress,
  Skeleton,
  Space,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
  theme,
} from 'antd';
import { getPlayerDossier } from '@/services/gameplay';
import {
  adjustPet,
  banPlayer,
  getPlayerDetail,
  grantItem,
  listGrantableItems,
  listPlayers,
  unbanPlayer,
} from '@/services/player';
import { getPlayerWallet } from '@/services/wallet';
import type {
  PetExtraView,
  PetStateView,
  PlayerDetail,
  PlayerDossier,
  PlayerView,
  WalletView,
} from '@/types';

const statusTag = (s: PlayerView['status']) =>
  s === 'banned' ? (
    <Badge status="error" text="已封禁" />
  ) : (
    <Badge status="success" text="正常" />
  );

const timeText = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString('zh-CN') : '-';

export default function PlayerPage() {
  const access = useAccess();
  const tableRef = useRef<ActionType>();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<PlayerDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);

  const openDetail = async (id: string) => {
    setCurrentId(id);
    setDetail(null);
    setOpen(true);
    setLoading(true);
    try {
      setDetail(await getPlayerDetail(id));
    } finally {
      setLoading(false);
    }
  };

  const refreshDetail = async () => {
    if (currentId) setDetail(await getPlayerDetail(currentId));
  };

  const columns: ProColumns<PlayerView>[] = [
    {
      title: '关键词',
      dataIndex: 'keyword',
      hideInTable: true,
      fieldProps: { placeholder: '搜索 玩家ID / openid / unionid' },
    },
    {
      // 「列出所有封禁账号」是风控与申诉复核的日常动作，关键词搜不出来
      title: '账号状态',
      dataIndex: 'statusFilter',
      hideInTable: true,
      valueType: 'select',
      valueEnum: {
        active: { text: '正常' },
        banned: { text: '已封禁' },
      },
    },
    { title: '玩家ID', dataIndex: 'id', hideInSearch: true, width: 90 },
    {
      title: 'openid',
      dataIndex: 'openid',
      hideInSearch: true,
      copyable: true,
      ellipsis: true,
      width: 240,
    },
    {
      title: 'unionid',
      dataIndex: 'unionid',
      hideInSearch: true,
      ellipsis: true,
      width: 240,
      render: (_, r) => r.unionid ?? '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      hideInSearch: true,
      width: 100,
      render: (_, r) => statusTag(r.status),
    },
    {
      title: '最近活跃',
      dataIndex: 'lastSeenAt',
      hideInSearch: true,
      valueType: 'dateTime',
      width: 170,
    },
    {
      title: '注册时间',
      dataIndex: 'createdAt',
      hideInSearch: true,
      valueType: 'dateTime',
      width: 170,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 180,
      fixed: 'right',
      render: (_, record) => {
        const actions = [
          <a key="detail" onClick={() => openDetail(record.id)}>
            详情
          </a>,
        ];
        if (access.canWritePlayer) {
          if (record.status === 'banned') {
            actions.push(
              <Popconfirm
                key="unban"
                title="确认解封该玩家？"
                onConfirm={async () => {
                  await unbanPlayer(record.id);
                  message.success('已解封');
                  tableRef.current?.reload();
                }}
              >
                <Typography.Link type="success">解封</Typography.Link>
              </Popconfirm>,
            );
          } else {
            actions.push(
              <ModalForm
                key="ban"
                title="封禁玩家"
                width={420}
                trigger={<Typography.Link type="danger">封禁</Typography.Link>}
                modalProps={{ destroyOnClose: true }}
                onFinish={async (v: { reason?: string }) => {
                  await banPlayer(record.id, v.reason);
                  message.success('已封禁');
                  tableRef.current?.reload();
                  return true;
                }}
              >
                <ProFormTextArea
                  name="reason"
                  label="封禁原因"
                  placeholder="选填，将记入审计与账号封禁原因"
                  fieldProps={{ maxLength: 255, showCount: true }}
                />
              </ModalForm>,
            );
          }
        }
        if (access.canGrantItem) {
          actions.push(
            <ModalForm
              key="grant"
              title={`补发物品 · 玩家 #${record.id}`}
              width={460}
              trigger={<a>补发物品</a>}
              modalProps={{ destroyOnClose: true }}
              onFinish={async (v: {
                assetCode: string;
                qty?: number;
                reason?: string;
              }) => {
                const res = await grantItem(record.id, v);
                // 幂等只到 24h 请求窗口，反馈里带上发放后的持有量，
                // 让运营能自己确认是否已经发过，而不是不确定就再点一次
                message.success(
                  `已补发 ${res.granted} 件，${res.assetCode} 当前持有 ${res.qty} 件`,
                );
                return true;
              }}
            >
              <ProFormSelect
                name="assetCode"
                label="物品"
                rules={[{ required: true, message: '请选择要补发的物品' }]}
                showSearch
                placeholder="按名称或 key 搜索"
                request={async () => {
                  const res = await listGrantableItems();
                  return res.list.map((i) => ({
                    label: `${i.name}（${i.key}${i.slot ? ` · ${i.slot}` : ''}）`,
                    value: i.key,
                  }));
                }}
              />
              <ProFormDigit
                name="qty"
                label="数量"
                initialValue={1}
                min={1}
                max={99}
                fieldProps={{ precision: 0 }}
              />
              <ProFormTextArea
                name="reason"
                label="补发原因"
                placeholder="选填，将记入审计"
                fieldProps={{ maxLength: 255, showCount: true }}
              />
            </ModalForm>,
          );
        }
        return actions;
      },
    },
  ];

  return (
    <PageContainer header={{ title: '玩家管理' }}>
      <ProTable<PlayerView>
        rowKey="id"
        actionRef={tableRef}
        columns={columns}
        headerTitle="玩家列表"
        cardBordered
        scroll={{ x: 'max-content' }}
        request={async (params) => {
          const p = params as {
            keyword?: string;
            statusFilter?: 'active' | 'banned';
          };
          const res = await listPlayers({
            page: params.current ?? 1,
            pageSize: params.pageSize ?? 20,
            keyword: p.keyword,
            status: p.statusFilter,
          });
          return { data: res.list, total: res.total, success: true };
        }}
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t.toLocaleString('zh-CN')} 条`,
        }}
        search={{ labelWidth: 'auto' }}
      />

      <Drawer
        title="玩家详情"
        width={620}
        open={open}
        destroyOnClose
        onClose={() => setOpen(false)}
        extra={
          detail ? (
            <Typography.Text type="secondary">
              #{detail.player.id}
            </Typography.Text>
          ) : null
        }
      >
        {loading || !detail ? (
          <Skeleton active paragraph={{ rows: 8 }} />
        ) : (
          <Tabs
            defaultActiveKey="overview"
            items={[
              {
                key: 'overview',
                label: '概览',
                children: (
                  <OverviewTab
                    detail={detail}
                    canWritePet={access.canWritePet}
                    onAdjusted={refreshDetail}
                  />
                ),
              },
              {
                key: 'gameplay',
                label: '玩法',
                // 懒加载：这一屏要扫七张表，只有处理具体申诉时才会点开
                children: <DossierTab playerId={detail.player.id} />,
              },
            ]}
          />
        )}
      </Drawer>
    </PageContainer>
  );
}

/** 概览 Tab：账户 + 钱包 + 宠物，客服打开抽屉的第一屏。 */
function OverviewTab({
  detail,
  canWritePet,
  onAdjusted,
}: {
  detail: PlayerDetail;
  canWritePet: boolean;
  onAdjusted: () => void | Promise<void>;
}) {
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={24}>
      <Section title="账户">
        <ProDescriptions
          column={2}
          dataSource={detail.player}
          columns={[
            { title: '玩家ID', dataIndex: 'id' },
            {
              title: '状态',
              dataIndex: 'status',
              render: () => statusTag(detail.player.status),
            },
            {
              title: 'openid',
              dataIndex: 'openid',
              copyable: true,
              ellipsis: true,
              span: 2,
            },
            {
              title: 'unionid',
              dataIndex: 'unionid',
              ellipsis: true,
              span: 2,
              // render 的第一个参数是已渲染的 dom 而非原值，判空要看 entity
              render: (_, r) => r.unionid ?? '-',
            },
            {
              title: '注册时间',
              dataIndex: 'createdAt',
              valueType: 'dateTime',
            },
            {
              title: '最近活跃',
              dataIndex: 'lastSeenAt',
              valueType: 'dateTime',
            },
            ...(detail.player.status === 'banned'
              ? [
                  {
                    title: '封禁原因',
                    dataIndex: 'bannedReason',
                    span: 2,
                    render: (_: React.ReactNode, r: PlayerView) =>
                      r.bannedReason ?? '-',
                  },
                  {
                    title: '封禁时间',
                    dataIndex: 'bannedAt',
                    valueType: 'dateTime',
                  },
                ]
              : []),
          ]}
        />
      </Section>

      <WalletSection playerId={detail.player.id} />

      <Section title={`宠物（${detail.pets.length}）`}>
        {detail.pets.length ? (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            {detail.pets.map((pet) => (
              <PetCard
                key={pet.id}
                playerId={detail.player.id}
                pet={pet}
                canWrite={canWritePet}
                onAdjusted={onAdjusted}
              />
            ))}
          </Space>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="该玩家尚无宠物"
          />
        )}
      </Section>
    </Space>
  );
}

const INSTANCE_STATE: Record<string, { text: string; color: string }> = {
  held: { text: '持有中', color: 'success' },
  listed: { text: '挂售中', color: 'processing' },
  escrowed: { text: '易货托管', color: 'warning' },
  burned: { text: '已销毁', color: 'error' },
};

/**
 * 玩法 Tab：把散在各玩法域、后台此前完全查不到的玩家态摊开。
 *
 * 单独一次请求且只在点开时才发：这一屏要扫七张表，而大多数工单只看概览。
 */
function DossierTab({ playerId }: { playerId: string }) {
  const [data, setData] = useState<PlayerDossier | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    getPlayerDossier(playerId)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        if (alive) setFailed(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [playerId]);

  if (loading) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (failed || !data) {
    return <Empty description="玩法档案读取失败" />;
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={24}>
      <Section title="签到与每日任务">
        {data.daily ? (
          <ProDescriptions
            column={2}
            dataSource={data.daily}
            columns={[
              {
                title: '连续签到',
                dataIndex: 'streak',
                render: (_, r) => `${r.streak} 天`,
              },
              { title: '累计签到', dataIndex: 'totalCheckins' },
              {
                title: '最后签到日',
                dataIndex: 'lastCheckinDay',
                render: (_, r) => r.lastCheckinDay ?? '从未签到',
              },
              {
                title: '任务日',
                dataIndex: 'taskDay',
                render: (_, r) => r.taskDay ?? '-',
              },
              {
                title: '今日已领任务',
                dataIndex: 'claimedTasks',
                span: 2,
                render: (_, r) =>
                  r.claimedTasks?.length ? (
                    <Space size={4} wrap>
                      {r.claimedTasks.map((t) => (
                        <Tag key={t}>{t}</Tag>
                      ))}
                    </Space>
                  ) : (
                    '未领取'
                  ),
              },
            ]}
          />
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="该玩家从未签到"
          />
        )}
      </Section>

      <Section title={`扭蛋保底（${data.gachaStates.length}）`}>
        {data.gachaStates.length ? (
          <Space direction="vertical" style={{ width: '100%' }} size={4}>
            {data.gachaStates.map((s) => (
              <div
                key={s.id}
                style={{ display: 'flex', justifyContent: 'space-between' }}
              >
                <Typography.Text>{s.poolKey}</Typography.Text>
                <Typography.Text type="secondary">
                  当前保底计数{' '}
                  <Typography.Text strong>{s.pity}</Typography.Text>
                  ，累计 {s.totalDraws} 抽
                </Typography.Text>
              </div>
            ))}
          </Space>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="尚未参与扭蛋"
          />
        )}
      </Section>

      <Section title={`唯一物品（${data.instances.length}）`}>
        {data.instances.length ? (
          <Space size={4} wrap>
            {data.instances.map((i) => {
              const st = INSTANCE_STATE[i.state] ?? {
                text: i.state,
                color: 'default',
              };
              return (
                <Tooltip
                  key={i.id}
                  title={`#${i.id}${i.serial ? ` · 编号 ${i.serial}` : ''} · 获得于 ${timeText(i.acquiredAt)}`}
                >
                  <Tag color={st.color}>
                    {i.assetCode} · {st.text}
                  </Tag>
                </Tooltip>
              );
            })}
          </Space>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="没有唯一物品实例"
          />
        )}
      </Section>

      <Section title={`宠物病症 / 穿戴 / 技巧`}>
        {data.petExtras.length ? (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            {data.petExtras.map((e) => (
              <PetExtraCard key={e.petId} extra={e} />
            ))}
          </Space>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="该玩家尚无宠物"
          />
        )}
      </Section>

      <Section title={`图鉴已领取（${data.dexClaims.length}）`}>
        {data.dexClaims.length ? (
          <Space size={4} wrap>
            {data.dexClaims.map((c) => (
              <Tooltip key={c.id} title={timeText(c.createdAt)}>
                <Tag>{c.entryKey}</Tag>
              </Tooltip>
            ))}
          </Space>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="尚未领取图鉴奖励"
          />
        )}
      </Section>

      <Section title={`收货地址（${data.addresses.length}）`}>
        {data.addresses.length ? (
          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            {data.addresses.map((a) => (
              <div key={a.id}>
                <Space size={6}>
                  <Typography.Text strong>{a.receiver}</Typography.Text>
                  <Typography.Text type="secondary">{a.phone}</Typography.Text>
                  {a.isDefault ? <Tag color="processing">默认</Tag> : null}
                </Space>
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {a.region} {a.detail}
                  </Typography.Text>
                </div>
              </div>
            ))}
          </Space>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="未填写收货地址"
          />
        )}
      </Section>
    </Space>
  );
}

/** 一只宠物的病症 / 穿戴 / 技巧。只列未治愈的病症，已治愈的是历史。 */
function PetExtraCard({ extra }: { extra: PetExtraView }) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadius,
        padding: 12,
      }}
    >
      <Typography.Text strong>宠物 #{extra.petId}</Typography.Text>
      <div style={{ marginTop: 8 }}>
        <ExtraRow label="病症">
          {extra.conditions.length ? (
            extra.conditions.map((c) => (
              <Tooltip
                key={c.conditionKey}
                title={`起病于 ${timeText(c.since)}`}
              >
                <Tag color="error">{c.conditionKey}</Tag>
              </Tooltip>
            ))
          ) : (
            <Typography.Text type="secondary">健康</Typography.Text>
          )}
        </ExtraRow>
        <ExtraRow label="穿戴">
          {extra.equips.length ? (
            extra.equips.map((e) => (
              <Tag key={e.slot}>
                {e.slot}: {e.assetCode}
              </Tag>
            ))
          ) : (
            <Typography.Text type="secondary">无</Typography.Text>
          )}
        </ExtraRow>
        <ExtraRow label="技巧">
          {extra.tricks.length ? (
            extra.tricks.map((t) => (
              <Tag key={t.trickKey}>
                {t.trickKey} {t.proficiency}%
              </Tag>
            ))
          ) : (
            <Typography.Text type="secondary">未学习</Typography.Text>
          )}
        </ExtraRow>
      </div>
    </div>
  );
}

function ExtraRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 6 }}>
      <Typography.Text
        type="secondary"
        style={{ fontSize: 12, width: 40, flexShrink: 0 }}
      >
        {label}
      </Typography.Text>
      <Space size={4} wrap style={{ flex: 1 }}>
        {children}
      </Space>
    </div>
  );
}

/** 抽屉里的分区标题：左侧一道主色竖条，把三块内容在视觉上切开。 */
function Section({
  title,
  extra,
  children,
}: {
  title: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { token } = theme.useToken();
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <Space size={8}>
          <span
            style={{
              display: 'inline-block',
              width: 3,
              height: 14,
              borderRadius: 2,
              background: token.colorPrimary,
            }}
          />
          <Typography.Text strong>{title}</Typography.Text>
        </Space>
        {extra}
      </div>
      {children}
    </div>
  );
}

/**
 * 钱包余额。单独取数而不并进玩家详情：钱包是经济域的读，权限归 wallet:read
 * —— 只有 player:read 的客服看不到金额。
 */
function WalletSection({ playerId }: { playerId: string }) {
  const access = useAccess();
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!access.canReadWallet) return;
    let alive = true;
    setLoading(true);
    setFailed(false);
    getPlayerWallet(playerId)
      .then((res) => {
        if (alive) setWallet(res.wallet);
      })
      .catch(() => {
        if (alive) setFailed(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [playerId, access.canReadWallet]);

  if (!access.canReadWallet) return null;

  return (
    <Section title="钱包">
      {loading ? (
        <Skeleton active paragraph={{ rows: 1 }} />
      ) : (
        <div style={{ display: 'flex', gap: 12 }}>
          <BalanceTile
            label="游戏币"
            value={wallet?.gameCoin}
            frozen={wallet?.gameCoinFrozen}
            failed={failed}
          />
          <BalanceTile
            label="营销积分"
            value={wallet?.marketingPoint}
            frozen={wallet?.marketingPointFrozen}
            failed={failed}
          />
        </div>
      )}
    </Section>
  );
}

/**
 * 单种资产的余额块。
 *
 * 冻结部分单独一行：交易上线后「有余额」不等于「能花」，挂单与出价会把可用
 * 余额转成冻结。只显示可用余额的话，客服面对「我明明有 3000 币却买不了 1000
 * 的东西」这类工单会查不出原因 —— 那 3000 里有 2500 正锁在他自己的出价上。
 */
function BalanceTile({
  label,
  value,
  frozen,
  failed,
}: {
  label: string;
  value?: number;
  frozen?: number;
  failed: boolean;
}) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        flex: 1,
        padding: '12px 16px',
        borderRadius: token.borderRadius,
        background: token.colorFillQuaternary,
      }}
    >
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {label}
      </Typography.Text>
      <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.4 }}>
        {failed ? (
          <Typography.Text type="danger" style={{ fontSize: 14 }}>
            读取失败
          </Typography.Text>
        ) : (
          (value ?? 0).toLocaleString('zh-CN')
        )}
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {frozen ? `冻结 ${frozen.toLocaleString('zh-CN')}` : '无冻结'}
      </Typography.Text>
    </div>
  );
}

/** 状态条按水位染色：低于阈值要一眼能看出来，而不是让运营去读百分比数字。 */
function statBarColor(
  percent: number,
  token: { colorError: string; colorWarning: string; colorPrimary: string },
) {
  if (percent < 25) return token.colorError;
  if (percent < 50) return token.colorWarning;
  return token.colorPrimary;
}

function StatBar({ label, percent }: { label: string; percent: number }) {
  const { token } = theme.useToken();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <Typography.Text
        type="secondary"
        style={{ fontSize: 12, width: 52, flexShrink: 0 }}
      >
        {label}
      </Typography.Text>
      <Progress
        percent={percent}
        size="small"
        strokeColor={statBarColor(percent, token)}
        style={{ flex: 1, marginBottom: 0 }}
      />
    </div>
  );
}

/** 单只宠物卡片：展示结算后状态 + 运营补偿调整入口。 */
function PetCard({
  playerId,
  pet,
  canWrite,
  onAdjusted,
}: {
  playerId: string;
  pet: PetStateView;
  canWrite: boolean;
  onAdjusted: () => void | Promise<void>;
}) {
  const { token } = theme.useToken();
  const name = pet.nickname || pet.species || '宠物';

  return (
    <div
      style={{
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadius,
        padding: 16,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <Space size={10}>
          {/* 没有宠物立绘资源，用首字兜底，至少让多只宠物之间有区分度 */}
          <span
            style={{
              width: 36,
              height: 36,
              borderRadius: token.borderRadius,
              background: token.colorPrimaryBg,
              color: token.colorPrimary,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 600,
            }}
          >
            {name.slice(0, 1)}
          </span>
          <Space size={6}>
            <Typography.Text strong>{name}</Typography.Text>
            {pet.isActive ? <Tag color="processing">出战</Tag> : null}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              #{pet.id}
            </Typography.Text>
          </Space>
        </Space>
        <Tooltip title={`阶段 ${pet.stage}`}>
          <Tag>Lv.{pet.level}</Tag>
        </Tooltip>
      </div>

      <Space direction="vertical" style={{ width: '100%' }} size={6}>
        <StatBar label="饱食度" percent={pet.hunger} />
        <StatBar label="心情" percent={pet.mood} />
        <StatBar label="清洁度" percent={pet.cleanliness} />
      </Space>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px 24px',
          marginTop: 12,
          paddingTop: 12,
          borderTop: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <MiniStat label="体力" value={`${pet.stamina}/${pet.staminaMax}`} />
        <MiniStat label="亲密度" value={pet.intimacy} />
        <MiniStat
          label="经验"
          value={`${pet.expIntoLevel}/${pet.expIntoLevel + pet.expToNext}`}
        />
        {/* 赛跑属性：接口一直在返回，此前从未展示，调赛跑数值时要看 */}
        <MiniStat label="速度" value={pet.speed} />
        <MiniStat label="耐力" value={pet.endurance} />
        <MiniStat label="上次活跃" value={timeText(pet.lastSeenAt)} />
      </div>

      {canWrite ? (
        <div style={{ textAlign: 'right', marginTop: 12 }}>
          <ModalForm
            title={`补偿调整 · ${name} #${pet.id}`}
            width={460}
            trigger={<Button size="small">补偿调整</Button>}
            modalProps={{ destroyOnClose: true }}
            initialValues={{ mode: 'delta' }}
            onFinish={async (v: Record<string, number | string>) => {
              const { mode, reason, ...nums } = v;
              const payload: Record<string, unknown> = {
                petId: pet.id,
                mode,
                reason,
              };
              for (const k of [
                'hunger',
                'mood',
                'cleanliness',
                'stamina',
                'intimacy',
                'exp',
              ]) {
                if (nums[k] !== undefined && nums[k] !== null && nums[k] !== '')
                  payload[k] = Number(nums[k]);
              }
              await adjustPet(playerId, payload as never);
              message.success('已调整');
              await onAdjusted();
              return true;
            }}
          >
            <ProFormRadio.Group
              name="mode"
              label="方式"
              options={[
                { label: '增减(delta)', value: 'delta' },
                { label: '设为(set)', value: 'set' },
              ]}
              rules={[{ required: true }]}
            />
            <ProForm.Group>
              <ProFormDigit name="hunger" label="饱食度" width="xs" />
              <ProFormDigit name="mood" label="心情" width="xs" />
              <ProFormDigit name="cleanliness" label="清洁度" width="xs" />
            </ProForm.Group>
            <ProForm.Group>
              <ProFormDigit name="stamina" label="体力" width="xs" />
              <ProFormDigit name="intimacy" label="亲密度" width="xs" />
              <ProFormDigit name="exp" label="经验" width="xs" />
            </ProForm.Group>
            <ProFormTextArea
              name="reason"
              label="备注"
              placeholder="选填，记入审计"
              fieldProps={{ maxLength: 255, showCount: true }}
            />
          </ModalForm>
        </div>
      ) : null}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Space size={6}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {label}
      </Typography.Text>
      <Typography.Text style={{ fontSize: 12 }}>{value}</Typography.Text>
    </Space>
  );
}
