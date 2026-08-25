import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { LoginForm, ProFormText } from '@ant-design/pro-components';
import { history, useModel } from '@umijs/max';
import { message } from 'antd';
import { TOKEN_KEY } from '@/constants';
import { login } from '@/services/auth';

export default function LoginPage() {
  const { setInitialState } = useModel('@@initialState');

  const onFinish = async (values: { username: string; password: string }) => {
    try {
      const res = await login(values);
      localStorage.setItem(TOKEN_KEY, res.token);
      await setInitialState((s: any) => ({ ...s, profile: res.profile }));
      message.success('登录成功');
      history.push('/');
      return true;
    } catch {
      return false;
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f0f2f5',
      }}
    >
      <div
        style={{
          width: 400,
          background: '#fff',
          padding: '32px 24px',
          borderRadius: 8,
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        }}
      >
        <LoginForm
          title="WarmPet 运营后台"
          subTitle="宠物养成 · 管理端"
          onFinish={onFinish}
        >
          <ProFormText
            name="username"
            fieldProps={{ size: 'large', prefix: <UserOutlined /> }}
            placeholder="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          />
          <ProFormText.Password
            name="password"
            fieldProps={{ size: 'large', prefix: <LockOutlined /> }}
            placeholder="密码"
            rules={[{ required: true, message: '请输入密码' }]}
          />
        </LoginForm>
      </div>
    </div>
  );
}
