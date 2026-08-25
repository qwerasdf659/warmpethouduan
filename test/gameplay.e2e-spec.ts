import { Server } from 'node:http';
import request from 'supertest';
import { E2eApp } from './helpers/e2e-app';

/**
 * 连真库的玩法主链路 e2e。
 *
 * 与单测的分工：单测覆盖纯函数与分支（衰减、等级、额度扣减），这里只验**跨模块接线**——
 * 守卫链、幂等、锁、经济记账、配置读取这些「单测 mock 掉就测不到」的东西。
 *
 * 数据纪律：所有数据挂在临时 `e2e_` 用户下，跑完删净；不改 `game_config`（配置只读）。
 */
describe('玩法主链路 (e2e, 连真库)', () => {
  let e2e: E2eApp;
  let server: Server;

  beforeAll(async () => {
    e2e = await E2eApp.boot();
    server = e2e.server;
  }, 60_000);

  afterAll(async () => {
    await e2e.teardown();
  }, 30_000);

  const biz = (tag: string) =>
    `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  describe('鉴权与封禁准入', () => {
    it('无令牌：写接口 401', async () => {
      await request(server)
        .post('/pet/create')
        .send({ bizId: biz('noauth') })
        .expect(401);
    });

    it('封禁玩家：写接口被拒、读接口放行', async () => {
      const p = await e2e.createPlayer({ status: 'banned' });
      const auth = { Authorization: `Bearer ${p.token}` };

      const write = await request(server)
        .post('/pet/create')
        .set(auth)
        .send({ bizId: biz('banned') });
      expect(write.status).toBe(403);

      // 读接口不拦：封禁玩家仍能看到自己的数据
      await request(server).get('/pet/list').set(auth).expect(200);
    });
  });

  describe('养宠 → 互动 → 记账', () => {
    it('建宠、查状态、喂食一条链路打通，且币变动落了流水', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };

      const created = await request(server)
        .post('/pet/create')
        .set(auth)
        .send({ bizId: biz('create'), species: 'cat', nickname: '测试宠' })
        .expect(201);
      const petId = (created.body as { pet: { id: string } }).pet.id;
      expect(petId).toBeTruthy();

      const state = await request(server)
        .get('/pet/state')
        .set(auth)
        .expect(200);
      const pet = (state.body as { pet: Record<string, number> }).pet;
      expect(pet.hunger).toBeGreaterThan(0);
      expect(pet.level).toBe(1);

      const before = await e2e.walletOf(p.userId);
      const fed = await request(server)
        .post('/pet/feed')
        .set(auth)
        .send({ bizId: biz('feed') })
        .expect(201);
      const after = await e2e.walletOf(p.userId);

      const fedPet = (fed.body as { pet: Record<string, number> }).pet;
      expect(fedPet.hunger).toBeGreaterThan(pet.hunger);
      expect(after.gameCoin).toBeGreaterThan(before.gameCoin);

      // 币的每一次变动都必须有流水，否则对账无从下手
      const ledger = await e2e.db.query<{ n: string }[]>(
        `SELECT count(*) n FROM ledger WHERE user_id = $1 AND pool = 'game'`,
        [p.userId],
      );
      expect(Number(ledger[0].n)).toBeGreaterThan(0);
    });

    it('同一 bizId 重复喂食：幂等回放，不重复加币', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };
      await request(server)
        .post('/pet/create')
        .set(auth)
        .send({ bizId: biz('create') })
        .expect(201);

      const id = biz('feed-idem');
      const first = await request(server)
        .post('/pet/feed')
        .set(auth)
        .send({ bizId: id });
      expect([200, 201]).toContain(first.status);
      const w1 = await e2e.walletOf(p.userId);

      const second = await request(server)
        .post('/pet/feed')
        .set(auth)
        .send({ bizId: id });
      expect([200, 201]).toContain(second.status);
      const w2 = await e2e.walletOf(p.userId);

      expect(w2.gameCoin).toBe(w1.gameCoin);
    });
  });

  describe('离线收益（P2-4 封顶与重复领取）', () => {
    it('接口不接受客户端申报时长：多传字段直接 400', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };
      // forbidNonWhitelisted 会拦下任何未声明字段，客户端无法注入 hours/elapsed
      await request(server)
        .post('/pet/offline/claim')
        .set(auth)
        .send({ bizId: biz('offline'), hours: 999 })
        .expect(400);
    });

    it('离线 12h 但 CAP 8h：预览与领取一致，且都按封顶算', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };
      await request(server)
        .post('/pet/create')
        .set(auth)
        .send({ bizId: biz('create') })
        .expect(201);
      await e2e.backdateOfflineBase(p.userId, 12);

      const preview = await request(server)
        .get('/pet/offline')
        .set(auth)
        .expect(200);
      const pv = preview.body as {
        elapsedSec: number;
        cappedSec: number;
        maxHours: number;
        claimableCoin: number;
      };
      expect(pv.elapsedSec).toBeGreaterThan(pv.cappedSec);
      expect(pv.cappedSec).toBe(pv.maxHours * 3600);

      const claimed = await request(server)
        .post('/pet/offline/claim')
        .set(auth)
        .send({ bizId: biz('offline') })
        .expect(201);
      expect((claimed.body as { gained: number }).gained).toBe(
        pv.claimableCoin,
      );
    });

    it('领取后基准前移：换新 bizId 再领也拿不到（不只靠幂等键）', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };
      await request(server)
        .post('/pet/create')
        .set(auth)
        .send({ bizId: biz('create') })
        .expect(201);
      await e2e.backdateOfflineBase(p.userId, 10);

      await request(server)
        .post('/pet/offline/claim')
        .set(auth)
        .send({ bizId: biz('offline-1') })
        .expect(201);

      const again = await request(server)
        .post('/pet/offline/claim')
        .set(auth)
        .send({ bizId: biz('offline-2') });
      expect(again.status).toBe(400);
    });
  });

  describe('赛跑（P2-5 判定输入）', () => {
    it('开赛→结算：奖励入账且留流水，同一场不能重复结算', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };
      await request(server)
        .post('/pet/create')
        .set(auth)
        .send({ bizId: biz('create') })
        .expect(201);

      const started = await request(server)
        .post('/race/start')
        .set(auth)
        .send({ bizId: biz('race-start'), trackKey: 'meadow' })
        .expect(201);
      const start = started.body as {
        raceId: string;
        rank: number;
        status: string;
      };
      expect(start.status).toBe('pending');
      expect(start.rank).toBeGreaterThanOrEqual(1);

      const settled = await request(server)
        .post('/race/settle')
        .set(auth)
        .send({ bizId: biz('race-settle'), raceId: start.raceId })
        .expect(201);
      const s = settled.body as { rewardCoin: number; duplicated: boolean };
      expect(s.duplicated).toBe(false);
      const walletAfterSettle = await e2e.walletOf(p.userId);

      // 重复结算不是报错，而是回放：奖励用服务端派生的 bizId(race:{id})，
      // 所以客户端换 bizId 也拿不到第二份
      const dup = await request(server)
        .post('/race/settle')
        .set(auth)
        .send({ bizId: biz('race-settle-2'), raceId: start.raceId })
        .expect(201);
      expect((dup.body as { duplicated: boolean }).duplicated).toBe(true);
      expect((await e2e.walletOf(p.userId)).gameCoin).toBe(
        walletAfterSettle.gameCoin,
      );
    });

    it('装扮不进入判定：戴上配饰后三围不变', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };
      const created = await request(server)
        .post('/pet/create')
        .set(auth)
        .send({ bizId: biz('create') })
        .expect(201);
      const petId = (created.body as { pet: { id: string } }).pet.id;
      await e2e.fundWallet(p.userId, { game: 5000 });

      type TracksRes = {
        battle: { power: number; level: number; staminaMax: number } | null;
      };
      const before = await request(server)
        .get('/race/tracks')
        .set(auth)
        .expect(200);
      const battleBefore = (before.body as TracksRes).battle;
      expect(battleBefore).not.toBeNull();

      // 买一件配饰并穿上（小皇冠 800 币，item_def 里 comfort=0）
      await request(server)
        .post('/wardrobe/buy')
        .set(auth)
        .send({ bizId: biz('buy'), itemKey: 'acc_crown' })
        .expect(201);
      await request(server)
        .post('/wardrobe/equip')
        .set(auth)
        .send({ itemKey: 'acc_crown', petId })
        .expect(201);

      const after = await request(server)
        .get('/race/tracks')
        .set(auth)
        .expect(200);
      const battleAfter = (after.body as TracksRes).battle;

      expect(battleAfter?.power).toBe(battleBefore?.power);
      expect(battleAfter?.staminaMax).toBe(battleBefore?.staminaMax);
    });
  });

  describe('每日签到（服务端派生幂等键）', () => {
    it('换 bizId 也只能签一次', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };

      const first = await request(server)
        .post('/daily/checkin')
        .set(auth)
        .send({ bizId: biz('checkin-1') })
        .expect(201);
      expect((first.body as { gained: number }).gained).toBeGreaterThan(0);
      const w1 = await e2e.walletOf(p.userId);

      const second = await request(server)
        .post('/daily/checkin')
        .set(auth)
        .send({ bizId: biz('checkin-2') });
      const w2 = await e2e.walletOf(p.userId);

      expect(second.status).toBe(400);
      expect(w2.gameCoin).toBe(w1.gameCoin);
    });
  });

  describe('兑换中心', () => {
    it('余额不足直接拒；余额足够则落单并扣净', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };

      const poor = await request(server)
        .post('/exchange/redeem')
        .set(auth)
        .send({ bizId: biz('redeem-poor'), exchangeKey: 'coupon_5' });
      expect(poor.status).toBe(400);

      await e2e.fundWallet(p.userId, { marketing: 500 });
      const rich = await request(server)
        .post('/exchange/redeem')
        .set(auth)
        .send({ bizId: biz('redeem-ok'), exchangeKey: 'coupon_5' })
        .expect(201);
      expect((rich.body as { order: { status: string } }).order.status).toBe(
        'pending',
      );
      expect((await e2e.walletOf(p.userId)).marketingPoint).toBe(0);
    });

    it('实物兑换缺收货地址：拒单', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };
      await e2e.fundWallet(p.userId, { marketing: 5000 });

      const res = await request(server)
        .post('/exchange/redeem')
        .set(auth)
        .send({ bizId: biz('redeem-noaddr'), exchangeKey: 'plush_toy' });
      expect(res.status).toBe(400);
    });
  });
});
