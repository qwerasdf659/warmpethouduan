import {
  ModalForm,
  PageContainer,
  ProDescriptions,
  ProForm,
  ProFormDigit,
  ProFormRadio,
  ProFormTextArea,
  ProTable,
} from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { useRef, useState } from 'react';
import {
  Button,
  Drawer,
  Empty,
  Popconfirm,
  Progress,
  Space,
  Tag,
  message,
} from 'antd';
import {
  adjustPet,
  banPlayer,
  getPlayerDetail,
  listPlayers,
  unbanPlayer,
} from '@/services/player';
import type { PetStateView, PlayerDetail, PlayerView } from '@/types';

export default function PlayerPage() {
  const access = useAccess();
  const tableRef = useRef<ActionType>();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<PlayerDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);

  const openDetail = async (id: string) => {
    setCurrentId(id);
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

  const statusTag = (s: PlayerView['status']) =>
    s === 'banned' ? (
      <Tag color="red">已封禁</Tag>
    ) : (
      <Tag color="green">正常</Tag>
    );

  const columns: ProColumns<PlayerView>[] = [
    {
      title: '关键词',
      dataIndex: 'keyword',
      hideInTable: true,
      fieldProps: { placeholder: '搜索 玩家ID / openid / unionid' },
    },
    { title: '玩家ID', dataIndex: 'id', hideInSearch: true, width: 90 },
    { title: 'openid', dataIndex: 'openid', hideInSearch: true, copyable: true },
    {
      title: 'unionid',
      dataIndex: 'unionid',
      hideInSearch: true,
      render: (v) => (v as string) ?? '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      hideInSearch: true,
      width: 90,
      render: (_, r) => statusTag(r.status),
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
      width: 160,
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
                <a style={{ color: '#52c41a' }}>解封</a>
              </Popconfirm>,
            );
          } else {
            actions.push(
              <ModalForm
                key="ban"
                title="封禁玩家"
                width={420}
                trigger={<a style={{ color: '#ff4d4f' }}>封禁</a>}
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
        request={async (params) => {
          const res = await listPlayers({
            page: params.current ?? 1,
            pageSize: params.pageSize ?? 20,
            keyword: (params as any).keyword,
          });
          return { data: res.list, total: res.total, success: true };
        }}
        pagination={{ pageSize: 20 }}
        search={{ labelWidth: 'auto' }}
      />

      <Drawer
        title="玩家详情"
        width={560}
        open={open}
        onClose={() => setOpen(false)}
        extra={
          <Button size="small" onClick={() => setOpen(false)}>
            关闭
          </Button>
        }
      >
        {detail ? (
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <ProDescriptions
              title="账户"
              column={1}
              loading={loading}
              dataSource={detail.player}
              columns={[
                { title: '玩家ID', dataIndex: 'id' },
                { title: 'openid', dataIndex: 'openid', copyable: true },
                {
                  title: 'unionid',
                  dataIndex: 'unionid',
                  render: (v) => (v as string) ?? '-',
                },
                {
                  title: '状态',
                  dataIndex: 'status',
                  render: () => statusTag(detail.player.status),
                },
                {
                  title: '封禁原因',
                  dataIndex: 'bannedReason',
                  render: (v) => (v as string) ?? '-',
                },
                {
                  title: '注册时间',
                  dataIndex: 'createdAt',
                  valueType: 'dateTime',
                },
              ]}
            />
            {detail.pets.length > 0 ? (
              detail.pets.map((pet) => (
                <PetCard
                  key={pet.id}
                  playerId={detail.player.id}
                  pet={pet}
                  canWrite={access.canWritePet}
                  onAdjusted={refreshDetail}
                />
              ))
            ) : (
              <Empty description="该玩家尚无宠物" />
            )}
          </Space>
        ) : (
          <Empty description="加载中…" />
        )}
      </Drawer>
    </PageContainer>
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
  const title = (
    <Space>
      {pet.nickname || pet.species || '宠物'}
      {pet.isActive ? <Tag color="blue">出战</Tag> : null}
      <span style={{ color: '#999', fontWeight: 'normal' }}>#{pet.id}</span>
    </Space>
  );

  return (
    <ProDescriptions title={title} column={1}>
      <ProDescriptions.Item label="饱食度">
        <Progress percent={pet.hunger} size="small" />
      </ProDescriptions.Item>
      <ProDescriptions.Item label="心情">
        <Progress percent={pet.mood} size="small" />
      </ProDescriptions.Item>
      <ProDescriptions.Item label="清洁度">
        <Progress percent={pet.cleanliness} size="small" />
      </ProDescriptions.Item>
      <ProDescriptions.Item label="体力">
        {pet.stamina} / {pet.staminaMax}
      </ProDescriptions.Item>
      <ProDescriptions.Item label="亲密度">{pet.intimacy}</ProDescriptions.Item>
      <ProDescriptions.Item label="等级 / 经验">
        Lv.{pet.level}（{pet.exp}，本级 {pet.expIntoLevel}/
        {pet.expIntoLevel + pet.expToNext}）
      </ProDescriptions.Item>
      <ProDescriptions.Item label="上次活跃">
        {new Date(pet.lastSeenAt).toLocaleString()}
      </ProDescriptions.Item>
      {canWrite ? (
        <ProDescriptions.Item label="运营">
          <ModalForm
            title={`补偿调整 · ${pet.nickname || pet.species} #${pet.id}`}
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
              await adjustPet(playerId, payload as any);
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
        </ProDescriptions.Item>
      ) : null}
    </ProDescriptions>
  );
}
