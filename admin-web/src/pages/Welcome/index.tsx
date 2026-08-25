import { PageContainer, ProCard, StatisticCard } from '@ant-design/pro-components';
import { useModel } from '@umijs/max';
import { Tag } from 'antd';

export default function WelcomePage() {
  const { initialState } = useModel('@@initialState');
  const profile = initialState?.profile;

  return (
    <PageContainer
      header={{ title: '概览' }}
      content={`欢迎，${profile?.displayName || profile?.username || ''}`}
    >
      <ProCard gutter={16} wrap>
        <StatisticCard
          colSpan={{ xs: 24, sm: 12, md: 8 }}
          statistic={{ title: '当前账号', value: profile?.username ?? '-' }}
        />
        <StatisticCard
          colSpan={{ xs: 24, sm: 12, md: 8 }}
          statistic={{ title: '角色数', value: profile?.roles?.length ?? 0 }}
        />
        <StatisticCard
          colSpan={{ xs: 24, sm: 12, md: 8 }}
          statistic={{
            title: '权限点数',
            value: profile?.permissions?.length ?? 0,
          }}
        />
      </ProCard>

      <ProCard title="我的角色" style={{ marginTop: 16 }}>
        {(profile?.roles ?? []).map((r) => (
          <Tag color="blue" key={r}>
            {r}
          </Tag>
        ))}
      </ProCard>

      <ProCard title="我的权限" style={{ marginTop: 16 }}>
        {(profile?.permissions ?? []).map((p) => (
          <Tag key={p} style={{ marginBottom: 8 }}>
            {p}
          </Tag>
        ))}
      </ProCard>
    </PageContainer>
  );
}
