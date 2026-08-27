import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { Space, Tabs, Tag } from 'antd';
import { listClinic, listClinicCases } from '@/services/playexp';
import type { ClinicCaseView, ClinicView } from '@/types';

function ClinicTab() {
  const columns: ProColumns<ClinicView>[] = [
    { title: '玩家', dataIndex: 'userId', width: 120, copyable: true },
    { title: '星级', dataIndex: 'star', width: 90 },
    {
      title: '正确率',
      dataIndex: 'correctCount',
      width: 140,
      render: (_, r) =>
        `${r.correctCount} / ${r.totalCount}` +
        (r.totalCount > 0
          ? `（${((r.correctCount / r.totalCount) * 100).toFixed(0)}%）`
          : ''),
    },
  ];

  return (
    <ProTable<ClinicView>
      rowKey="userId"
      columns={columns}
      search={false}
      pagination={{ pageSize: 20 }}
      request={async (params) => {
        const res = await listClinic({
          page: params.current ?? 1,
          pageSize: params.pageSize ?? 20,
        });
        return { data: res.list, total: res.total, success: true };
      }}
    />
  );
}

function CaseTab() {
  const columns: ProColumns<ClinicCaseView>[] = [
    { title: '病例ID', dataIndex: 'id', width: 90, copyable: true },
    { title: '玩家', dataIndex: 'userId', width: 120, copyable: true },
    { title: '病症', dataIndex: 'conditionKey', width: 140 },
    { title: '状态', dataIndex: 'status', width: 100 },
    {
      title: '诊断',
      dataIndex: 'correct',
      width: 80,
      render: (_, r) =>
        r.correct ? <Tag color="green">正确</Tag> : <Tag color="red">错误</Tag>,
    },
    { title: '奖励金币', dataIndex: 'rewardCoin', width: 90 },
    {
      title: '时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 170,
    },
  ];

  return (
    <ProTable<ClinicCaseView>
      rowKey="id"
      columns={columns}
      search={false}
      pagination={{ pageSize: 20 }}
      request={async (params) => {
        const res = await listClinicCases({
          page: params.current ?? 1,
          pageSize: params.pageSize ?? 20,
        });
        return { data: res.list, total: res.total, success: true };
      }}
    />
  );
}

export default function ClinicPage() {
  return (
    <PageContainer header={{ title: '诊所管理' }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Tabs
          items={[
            { key: 'clinic', label: '玩家汇总', children: <ClinicTab /> },
            { key: 'case', label: '诊断病例', children: <CaseTab /> },
          ]}
        />
      </Space>
    </PageContainer>
  );
}
