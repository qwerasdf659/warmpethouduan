import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { Tag, Tooltip, Typography, theme } from 'antd';
import { listAssetLots } from '@/services/gameplay';
import type { AssetLotView } from '@/types';

/** 距过期不足这么多天就标红。一周是运营能来得及做公告的最短窗口。 */
const EXPIRY_WARN_DAYS = 7;

/**
 * 资产批次（lot）。
 *
 * 余额只是批次的汇总，「这笔钱是哪一批发的、哪天过期」只有这张表知道，而且
 * 这个信息事后补不回来。运营会用到它的两个场景：核对某玩家余额怎么攒起来的，
 * 以及在过期批处理跑之前先看一眼这周要过期多少 —— 那正是投诉高峰。
 */
export default function LotsPage() {
  const { token } = theme.useToken();

  const daysLeft = (iso: string | null) => {
    if (!iso) return null;
    return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  };

  const columns: ProColumns<AssetLotView>[] = [
    { title: '批次ID', dataIndex: 'id', width: 90, hideInSearch: true },
    {
      title: '玩家ID',
      dataIndex: 'userId',
      width: 110,
      copyable: true,
      // 系统账户没有 user_id，展示账户号，免得出现一列空白让人以为是脏数据
      render: (_, r) => r.userId ?? `系统账户#${r.accountId}`,
    },
    { title: '资产', dataIndex: 'assetCode', width: 160 },
    {
      title: '筛选',
      dataIndex: 'filter',
      hideInTable: true,
      valueType: 'select',
      valueEnum: {
        remaining: { text: '仅剩余 > 0' },
        expiring: { text: '仅有过期时间且未用完' },
      },
    },
    {
      title: '剩余',
      dataIndex: 'remaining',
      width: 120,
      hideInSearch: true,
      align: 'right',
      render: (_, r) => Number(r.remaining).toLocaleString('zh-CN'),
    },
    {
      title: '冻结',
      dataIndex: 'frozen',
      width: 110,
      hideInSearch: true,
      align: 'right',
      render: (_, r) => Number(r.frozen).toLocaleString('zh-CN'),
    },
    {
      title: '累计发行',
      dataIndex: 'issuedTotal',
      width: 120,
      hideInSearch: true,
      align: 'right',
      render: (_, r) => Number(r.issuedTotal).toLocaleString('zh-CN'),
    },
    {
      title: '过期时间',
      dataIndex: 'expiresAt',
      width: 210,
      hideInSearch: true,
      render: (_, r) => {
        if (!r.expiresAt) {
          return <Typography.Text type="secondary">永不过期</Typography.Text>;
        }
        const d = daysLeft(r.expiresAt);
        const text = new Date(r.expiresAt).toLocaleString('zh-CN');
        if (d === null) return text;
        if (d < 0) return <Tag color="default">已过期 · {text}</Tag>;
        return (
          <Tooltip title={text}>
            <Tag color={d <= EXPIRY_WARN_DAYS ? 'error' : 'default'}>
              {d} 天后过期
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      hideInSearch: true,
      width: 170,
    },
  ];

  return (
    <PageContainer
      header={{ title: '资产批次' }}
      content={
        <Typography.Text>
          余额是批次的汇总；批次承载 FIFO 消耗与过期。
          <Typography.Text style={{ color: token.colorError }}>
            {` ${EXPIRY_WARN_DAYS} 天内`}
          </Typography.Text>
          即将过期的批次会标红，用「仅有过期时间且未用完」筛选可快速盘点。
        </Typography.Text>
      }
    >
      <ProTable<AssetLotView>
        rowKey="id"
        headerTitle="批次列表"
        cardBordered
        columns={columns}
        scroll={{ x: 'max-content' }}
        search={{ labelWidth: 'auto' }}
        pagination={{
          pageSize: 20,
          showTotal: (t) => `共 ${t.toLocaleString('zh-CN')} 条`,
        }}
        request={async (params) => {
          const res = await listAssetLots({
            page: params.current ?? 1,
            pageSize: params.pageSize ?? 20,
            userId: params.userId,
            assetCode: params.assetCode,
            filter: params.filter,
          });
          return { data: res.list, total: res.total, success: true };
        }}
      />
    </PageContainer>
  );
}
