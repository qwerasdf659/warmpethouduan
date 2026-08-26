import request from 'supertest';
import { E2eApp } from './helpers/e2e-app';

/**
 * 后台端点 e2e。
 *
 * 为什么单独一份而不并进 gameplay：后台有 56 个端点却长期零 e2e 覆盖，路由前缀刚做过
 * 一轮收缩（/auth/admin → /admin/auth、钱包挪进 /admin/wallet），当时只靠手工冒烟看状态码。
 * 这份补的是「登录链路 + 鉴权分支 + 一条真正改数据的写操作」这三段主干，
 * 不追求逐端点铺满——56 个端点里绝大多数是同一套守卫加不同 service 调用。
 */
describe('后台 (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await E2eApp.boot();
  });

  afterAll(async () => {
    await e2e.teardown();
  });

  // 各用例都要打登录端点，而它限额 10 次/分钟且失败会累计锁定，
  // 不隔离的话用例之间会互相把对方顶成 401/429。
  beforeEach(async () => {
    await e2e.resetThrottle();
  });

  // 不加 async：要保留 supertest 的链式 .expect()，包成 Promise 就没了
  function login(username: string, password: string) {
    return request(e2e.server)
      .post('/admin/auth/login')
      .send({ username, password });
  }

  describe('登录链路', () => {
    it('口令正确时返回令牌与身份档案', async () => {
      const admin = await e2e.createAdmin({ permissions: ['wallet:read'] });

      const res = await login(admin.username, admin.password).expect(201);
      const body = res.body as {
        token: string;
        profile: { username: string; permissions: string[] };
      };

      expect(typeof body.token).toBe('string');
      expect(body.profile.username).toBe(admin.username);
      expect(body.profile.permissions).toContain('wallet:read');
    });

    it('令牌可用于访问 /admin/auth/me', async () => {
      const admin = await e2e.createAdmin({ permissions: [] });
      const { token } = (await login(admin.username, admin.password)).body as {
        token: string;
      };

      const me = await request(e2e.server)
        .get('/admin/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect((me.body as { username: string }).username).toBe(admin.username);
    });

    it('无令牌访问后台端点返回 401', async () => {
      await request(e2e.server).get('/admin/wallet/ledger').expect(401);
    });

    it('用户名不存在与口令错误返回同一提示（防账号枚举）', async () => {
      const admin = await e2e.createAdmin({ permissions: [] });

      const wrongPassword = await login(admin.username, 'definitely-wrong');
      const noSuchUser = await login(
        'e2e_no_such_admin_xyz',
        'definitely-wrong',
      );

      expect(wrongPassword.status).toBe(401);
      expect(noSuchUser.status).toBe(401);
      expect((noSuchUser.body as { message: string }).message).toBe(
        (wrongPassword.body as { message: string }).message,
      );
    });
  });

  describe('登录爆破防护', () => {
    it('连续 5 次错口令后锁定，且锁定期内正确口令同样被拒、提示一模一样', async () => {
      const admin = await e2e.createAdmin({ permissions: [] });

      const failures: request.Response[] = [];
      for (let i = 0; i < 5; i++) {
        failures.push(await login(admin.username, `wrong-${i}`));
      }
      expect(failures.every((r) => r.status === 401)).toBe(true);

      // 关键：口令是对的也必须拒。若这里放行，锁定就只是「拖慢」而非「拦住」。
      const locked = await login(admin.username, admin.password);
      expect(locked.status).toBe(401);
      // 提示必须与口令错误逐字相同，否则攻击者能用它反推刚才那次猜对了
      expect((locked.body as { message: string }).message).toBe(
        (failures[0].body as { message: string }).message,
      );
    });

    it('锁定只针对被打的那个账号，不波及其他账号', async () => {
      const victim = await e2e.createAdmin({ permissions: [] });
      const bystander = await e2e.createAdmin({ permissions: [] });

      for (let i = 0; i < 5; i++) await login(victim.username, `wrong-${i}`);

      // 同一个 IP 的失败计数上限是 20，5 次远未触顶，所以旁观者应当照常登录
      await login(bystander.username, bystander.password).expect(201);
    });

    it('登录端点超过每分钟 10 次后返回 429', async () => {
      const admin = await e2e.createAdmin({ permissions: [] });

      const codes: number[] = [];
      for (let i = 0; i < 12; i++) {
        codes.push((await login(admin.username, `wrong-${i}`)).status);
      }

      // 前 10 次走到业务逻辑（401），之后被限流守卫在进入控制器前挡下
      expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
      expect(codes.slice(10)).toEqual([429, 429]);
    });
  });

  describe('权限点校验', () => {
    it('权限不足时返回 403，而不是悄悄放行', async () => {
      const admin = await e2e.createAdmin({ permissions: ['player:read'] });
      const { token } = (await login(admin.username, admin.password)).body as {
        token: string;
      };

      await request(e2e.server)
        .get('/admin/wallet/ledger')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('有 wallet:read 时可读账本', async () => {
      const admin = await e2e.createAdmin({ permissions: ['wallet:read'] });
      const { token } = (await login(admin.username, admin.password)).body as {
        token: string;
      };

      await request(e2e.server)
        .get('/admin/wallet/ledger')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('只读权限不能发币（写操作要 wallet:write）', async () => {
      const admin = await e2e.createAdmin({ permissions: ['wallet:read'] });
      const player = await e2e.createPlayer();
      const { token } = (await login(admin.username, admin.password)).body as {
        token: string;
      };

      await request(e2e.server)
        .post(`/admin/wallet/players/${player.userId}/grant`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          bizId: `e2e-denied-${Date.now()}`,
          pool: 'game',
          direction: 'grant',
          amount: 10,
        })
        .expect(403);

      // 被拦下就不该有任何账变
      expect((await e2e.walletOf(player.userId)).gameCoin).toBe(0);
    });
  });

  describe('人工发币', () => {
    it('发币真的落到钱包，且同一 bizId 重放不会发两次', async () => {
      const admin = await e2e.createAdmin({
        permissions: ['wallet:read', 'wallet:write'],
      });
      const player = await e2e.createPlayer();
      const { token } = (await login(admin.username, admin.password)).body as {
        token: string;
      };

      const bizId = `e2e-grant-${Date.now()}`;
      const payload = {
        bizId,
        pool: 'game' as const,
        direction: 'grant' as const,
        amount: 120,
        reason: 'e2e',
      };
      const send = () =>
        request(e2e.server)
          .post(`/admin/wallet/players/${player.userId}/grant`)
          .set('Authorization', `Bearer ${token}`)
          .send(payload);

      await send().expect(201);
      expect((await e2e.walletOf(player.userId)).gameCoin).toBe(120);

      // 幂等：运营手抖点两次、或前端超时重试，都不能变成发两次
      await send();
      expect((await e2e.walletOf(player.userId)).gameCoin).toBe(120);
    });
  });
});
