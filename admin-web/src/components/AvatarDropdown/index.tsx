import { InfoCircleOutlined, LogoutOutlined } from '@ant-design/icons';
import { Descriptions, Dropdown, Empty, Modal, Space, Tag } from 'antd';
import { useState } from 'react';
import type { AdminProfile } from '@/types';

interface Props {
  /** ProLayout 传进来的头像本体，作为 Dropdown 的触发器。 */
  children: React.ReactNode;
  profile?: AdminProfile;
  onLogout: () => void;
}

/**
 * 头像下拉：退出登录 + 「我的角色与权限」。
 *
 * 权限点列表是排查"为什么这个按钮我点不了"的第一手信息，所以放在全局可达的位置，
 * 而不是某个需要先导航过去的页面。
 */
export default function AvatarDropdown({ children, profile, onLogout }: Props) {
  const [open, setOpen] = useState(false);
  const roles = profile?.roles ?? [];
  const permissions = profile?.permissions ?? [];

  return (
    <>
      <Dropdown
        menu={{
          items: [
            {
              key: 'access',
              icon: <InfoCircleOutlined />,
              label: '我的角色与权限',
              onClick: () => setOpen(true),
            },
            { type: 'divider' },
            {
              key: 'logout',
              icon: <LogoutOutlined />,
              label: '退出登录',
              onClick: onLogout,
            },
          ],
        }}
      >
        {children}
      </Dropdown>

      <Modal
        title="我的角色与权限"
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={640}
      >
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="账号">
            {profile?.username ?? '-'}
          </Descriptions.Item>
          <Descriptions.Item label={`角色（${roles.length}）`}>
            {roles.length === 0 ? (
              '-'
            ) : (
              <Space size={[4, 4]} wrap>
                {roles.map((r) => (
                  <Tag color="blue" key={r}>
                    {r}
                  </Tag>
                ))}
              </Space>
            )}
          </Descriptions.Item>
          <Descriptions.Item label={`权限点（${permissions.length}）`}>
            {permissions.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="无权限点"
              />
            ) : (
              <Space size={[4, 4]} wrap>
                {permissions.map((p) => (
                  <Tag key={p}>{p}</Tag>
                ))}
              </Space>
            )}
          </Descriptions.Item>
        </Descriptions>
      </Modal>
    </>
  );
}
