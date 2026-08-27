import {
  ModalForm,
  PageContainer,
  ProFormDateTimePicker,
  ProFormSelect,
  ProFormSwitch,
  ProFormText,
  ProFormTextArea,
  ProTable,
} from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { useRef, useState } from 'react';
import { Button, Modal, Popconfirm, Tag, Typography, message } from 'antd';
import {
  createEvent,
  listEventProgress,
  listEvents,
  removeEvent,
  updateEvent,
} from '@/services/event';
import type { GameEventProgressView, GameEventView } from '@/types';

const typeMeta: Record<GameEventView['type'], { color: string; text: string }> =
  {
    gacha_pool: { color: 'purple', text: '扭蛋池' },
    shop: { color: 'blue', text: '商店' },
    task: { color: 'green', text: '任务' },
    login: { color: 'gold', text: '登录' },
  };

const typeOptions = [
  { label: '扭蛋池', value: 'gacha_pool' },
  { label: '商店', value: 'shop' },
  { label: '任务', value: 'task' },
  { label: '登录', value: 'login' },
];

/** 活动的创建/编辑表单。payload 用 JSON 文本框，提交时校验合法性。 */
function EventForm({
  title,
  trigger,
  initialValues,
  editing,
  onOk,
}: {
  title: string;
  trigger: React.ReactElement;
  initialValues?: Partial<GameEventView>;
  editing?: boolean;
  onOk: () => void;
}) {
  return (
    <ModalForm
      title={title}
      width={560}
      trigger={trigger}
      modalProps={{ destroyOnClose: true }}
      initialValues={
        initialValues
          ? {
              ...initialValues,
              payload:
                initialValues.payload == null
                  ? ''
                  : JSON.stringify(initialValues.payload, null, 2),
            }
          : { type: 'gacha_pool', enabled: true, payload: '' }
      }
      onFinish={async (v: {
        key: string;
        name: string;
        type: GameEventView['type'];
        startsAt: string;
        endsAt: string;
        banner?: string;
        payload?: string;
        enabled?: boolean;
      }) => {
        let payload: Record<string, unknown> | undefined;
        if (v.payload?.trim()) {
          try {
            payload = JSON.parse(v.payload);
          } catch {
            message.error('payload 必须是合法 JSON');
            return false;
          }
        }
        const base = {
          name: v.name,
          type: v.type,
          startsAt: new Date(v.startsAt).toISOString(),
          endsAt: new Date(v.endsAt).toISOString(),
          banner: v.banner || undefined,
          payload,
          enabled: v.enabled,
        };
        if (editing) {
          await updateEvent(v.key, base);
          message.success('已保存');
        } else {
          await createEvent({ key: v.key, ...base });
          message.success('已创建');
        }
        onOk();
        return true;
      }}
    >
      <ProFormText
        name="key"
        label="key"
        tooltip="活动唯一标识，创建后不可修改"
        disabled={editing}
        rules={[{ required: true }]}
      />
      <ProFormText name="name" label="名称" rules={[{ required: true }]} />
      <ProFormSelect
        name="type"
        label="类型"
        options={typeOptions}
        rules={[{ required: true }]}
      />
      <ProFormDateTimePicker
        name="startsAt"
        label="开始时间"
        rules={[{ required: true }]}
      />
      <ProFormDateTimePicker
        name="endsAt"
        label="结束时间"
        rules={[{ required: true }]}
      />
      <ProFormText
        name="banner"
        label="Banner"
        placeholder="活动图 URL，可留空"
      />
      <ProFormTextArea
        name="payload"
        label="payload (JSON)"
        fieldProps={{ rows: 8 }}
        extra="活动差异化配置，按类型自定义。留空表示无。"
      />
      <ProFormSwitch name="enabled" label="启用" />
    </ModalForm>
  );
}

/** 查看某个活动的玩家参与进度。 */
function ProgressModal(props: {
  event: GameEventView | null;
  onClose: () => void;
}) {
  const { event } = props;
  const columns: ProColumns<GameEventProgressView>[] = [
    { title: 'ID', dataIndex: 'id', width: 80, copyable: true },
    { title: '玩家', dataIndex: 'userId', width: 120, copyable: true },
    {
      title: '进度',
      dataIndex: 'progress',
      render: (_, r) => (
        <Typography.Text code ellipsis style={{ maxWidth: 360 }}>
          {JSON.stringify(r.progress)}
        </Typography.Text>
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      valueType: 'dateTime',
      width: 170,
    },
  ];

  return (
    <Modal
      open={!!event}
      title={event ? `参与进度 · ${event.name}` : ''}
      onCancel={props.onClose}
      onOk={props.onClose}
      width={720}
      destroyOnClose
    >
      {event ? (
        <ProTable<GameEventProgressView>
          rowKey="id"
          columns={columns}
          search={false}
          options={false}
          pagination={{ pageSize: 20 }}
          request={async (params) => {
            const res = await listEventProgress(event.key, {
              page: params.current ?? 1,
              pageSize: params.pageSize ?? 20,
            });
            return { data: res.list, total: res.total, success: true };
          }}
        />
      ) : null}
    </Modal>
  );
}

export default function EventsPage() {
  const access = useAccess();
  const tableRef = useRef<ActionType>();
  const canWrite = access.canWriteEvent;
  const [progressEvent, setProgressEvent] = useState<GameEventView | null>(
    null,
  );

  const columns: ProColumns<GameEventView>[] = [
    { title: 'key', dataIndex: 'key', width: 160, copyable: true },
    { title: '名称', dataIndex: 'name' },
    {
      title: '类型',
      dataIndex: 'type',
      width: 100,
      render: (_, r) => {
        const m = typeMeta[r.type] ?? { color: 'default', text: r.type };
        return <Tag color={m.color}>{m.text}</Tag>;
      },
    },
    {
      title: '开始',
      dataIndex: 'startsAt',
      valueType: 'dateTime',
      width: 170,
    },
    {
      title: '结束',
      dataIndex: 'endsAt',
      valueType: 'dateTime',
      width: 170,
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 80,
      render: (_, r) =>
        r.enabled ? <Tag color="green">是</Tag> : <Tag>否</Tag>,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 180,
      render: (_, record) => {
        const actions = [
          <a key="progress" onClick={() => setProgressEvent(record)}>
            查看进度
          </a>,
        ];
        if (canWrite) {
          actions.push(
            <EventForm
              key="edit"
              title={`编辑活动 · ${record.key}`}
              trigger={<a>编辑</a>}
              initialValues={record}
              editing
              onOk={() => tableRef.current?.reload()}
            />,
            <Popconfirm
              key="del"
              title="确认删除该活动？"
              onConfirm={async () => {
                await removeEvent(record.key);
                message.success('已删除');
                tableRef.current?.reload();
              }}
            >
              <a style={{ color: '#ff4d4f' }}>删除</a>
            </Popconfirm>,
          );
        }
        return actions;
      },
    },
  ];

  return (
    <PageContainer
      header={{ title: '活动管理' }}
      extra={
        canWrite
          ? [
              <EventForm
                key="create"
                title="新建活动"
                trigger={<Button type="primary">新建活动</Button>}
                onOk={() => tableRef.current?.reload()}
              />,
            ]
          : []
      }
    >
      <ProTable<GameEventView>
        rowKey="key"
        actionRef={tableRef}
        columns={columns}
        search={false}
        pagination={{ pageSize: 20 }}
        request={async (params) => {
          const res = await listEvents({
            page: params.current ?? 1,
            pageSize: params.pageSize ?? 20,
          });
          return { data: res.list, total: res.total, success: true };
        }}
      />
      <ProgressModal
        event={progressEvent}
        onClose={() => setProgressEvent(null)}
      />
    </PageContainer>
  );
}
