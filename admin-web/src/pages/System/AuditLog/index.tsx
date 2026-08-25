import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { Tag, Typography } from 'antd';
import { listAuditLogs } from '@/services/audit';
import type { AuditLog } from '@/types';

export default function AuditLogPage() {
  const columns: ProColumns<AuditLog>[] = [
    { title: 'ID', dataIndex: 'id', width: 80, hideInSearch: true },
    { title: '操作人', dataIndex: 'adminUsername', hideInSearch: true },
    {
      title: '管理员ID',
      dataIndex: 'adminUserId',
      hideInTable: true,
      fieldProps: { placeholder: '按管理员ID过滤' },
    },
    {
      title: '动作',
      dataIndex: 'action',
      hideInSearch: true,
      render: (v) => (v as string) ?? '-',
    },
    { title: '方法', dataIndex: 'method', width: 80, hideInSearch: true },
    { title: '路径', dataIndex: 'path', hideInSearch: true, ellipsis: true },
    {
      title: '结果',
      dataIndex: 'success',
      width: 90,
      valueType: 'select',
      valueEnum: {
        true: { text: '成功' },
        false: { text: '失败' },
      },
      render: (_, r) =>
        r.success ? (
          <Tag color="green">{r.statusCode}</Tag>
        ) : (
          <Tag color="red">{r.statusCode}</Tag>
        ),
    },
    {
      title: '耗时(ms)',
      dataIndex: 'durationMs',
      width: 100,
      hideInSearch: true,
    },
    { title: 'IP', dataIndex: 'ip', width: 130, hideInSearch: true },
    {
      title: '时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 180,
      hideInSearch: true,
    },
  ];

  return (
    <PageContainer header={{ title: '审计日志' }}>
      <ProTable<AuditLog>
        rowKey="id"
        columns={columns}
        pagination={{ pageSize: 20 }}
        search={{ labelWidth: 'auto' }}
        expandable={{
          expandedRowRender: (record) => (
            <Typography.Paragraph>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(record.requestBody ?? {}, null, 2)}
              </pre>
              {record.errorMessage ? (
                <div style={{ color: '#ff4d4f' }}>
                  错误：{record.errorMessage}
                </div>
              ) : null}
            </Typography.Paragraph>
          ),
        }}
        request={async (params) => {
          const successVal = (params as any).success as
            | 'true'
            | 'false'
            | undefined;
          const res = await listAuditLogs({
            page: params.current ?? 1,
            pageSize: params.pageSize ?? 20,
            adminUserId: (params as any).adminUserId || undefined,
            success: successVal,
          });
          return { data: res.list, total: res.total, success: true };
        }}
      />
    </PageContainer>
  );
}
