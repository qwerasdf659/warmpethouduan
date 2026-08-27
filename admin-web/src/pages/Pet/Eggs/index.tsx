import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { Tag } from 'antd';
import { listBreedEggs } from '@/services/playexp';
import type { EggView } from '@/types';

const statusTag = (s: string) => {
  const map: Record<string, { color: string; text: string }> = {
    incubating: { color: 'blue', text: '孵化中' },
    hatched: { color: 'green', text: '已孵化' },
    cancelled: { color: 'default', text: '已取消' },
  };
  const m = map[s] ?? { color: 'default', text: s };
  return <Tag color={m.color}>{m.text}</Tag>;
};

export default function EggsPage() {
  const columns: ProColumns<EggView>[] = [
    { title: '蛋ID', dataIndex: 'id', width: 90, copyable: true },
    { title: '玩家', dataIndex: 'userId', width: 110, copyable: true },
    {
      title: '父本A',
      dataIndex: 'parentAId',
      width: 110,
      render: (v) => (v as string) ?? '-',
    },
    {
      title: '父本B',
      dataIndex: 'parentBId',
      width: 110,
      render: (v) => (v as string) ?? '-',
    },
    { title: '品种', dataIndex: 'species', width: 120 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (_, r) => statusTag(r.status),
    },
    {
      title: '可孵化时间',
      dataIndex: 'hatchAt',
      valueType: 'dateTime',
      width: 170,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 170,
    },
  ];

  return (
    <PageContainer header={{ title: '繁殖管理' }}>
      <ProTable<EggView>
        rowKey="id"
        columns={columns}
        search={false}
        pagination={{ pageSize: 20 }}
        request={async (params) => {
          const res = await listBreedEggs({
            page: params.current ?? 1,
            pageSize: params.pageSize ?? 20,
          });
          return { data: res.list, total: res.total, success: true };
        }}
      />
    </PageContainer>
  );
}
