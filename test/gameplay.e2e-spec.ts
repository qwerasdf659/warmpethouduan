import { Server } from 'node:http';
import request from 'supertest';
import { E2eApp } from './helpers/e2e-app';
import { GameConfigService } from '../src/config/game-config.service';

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

    it('家园舒适度提升离线时薪（A3 接线）', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };
      await request(server)
        .post('/pet/create')
        .set(auth)
        .send({ bizId: biz('create') })
        .expect(201);
      await e2e.backdateOfflineBase(p.userId, 12);

      const before = await request(server)
        .get('/pet/offline')
        .set(auth)
        .expect(200);
      const plain = before.body as {
        coinPerHour: number;
        comfortFactor: number;
        claimableCoin: number;
      };
      expect(plain.comfortFactor).toBe(0);

      // 买两件家具并摆上，把舒适度顶到系数上限附近。
      // 充值额按目录**实价**算，不写死数字——家具定价是运营可调的，
      // 写死过一次就会在下次调价时把这条用例连坐成「余额不足」。
      const wanted = ['furn_tree', 'furn_sofa'];
      const catalog = (await request(server).get('/home').set(auth).expect(200))
        .body as { items: { key: string; price: number }[] };
      const cost = wanted.reduce(
        (sum, key) =>
          sum + (catalog.items.find((i) => i.key === key)?.price ?? 0),
        0,
      );
      expect(cost).toBeGreaterThan(0);
      await e2e.fundWallet(p.userId, { game: cost });

      for (const itemKey of wanted) {
        await request(server)
          .post('/home/buy')
          .set(auth)
          .send({ bizId: biz(`buy-${itemKey}`), itemKey })
          .expect(201);
        await request(server)
          .post('/home/place')
          .set(auth)
          .send({ itemKey })
          .expect(201);
      }

      const after = await request(server)
        .get('/pet/offline')
        .set(auth)
        .expect(200);
      const cozy = after.body as {
        coinPerHour: number;
        comfortFactor: number;
        claimableCoin: number;
      };
      expect(cozy.comfortFactor).toBeGreaterThan(0);
      expect(cozy.coinPerHour).toBeGreaterThan(plain.coinPerHour);
      expect(cozy.claimableCoin).toBeGreaterThan(plain.claimableCoin);
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
        .post('/items/wardrobe/buy')
        .set(auth)
        .send({ bizId: biz('buy'), itemKey: 'acc_crown' })
        .expect(201);
      await request(server)
        .post('/items/wardrobe/equip')
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

    it('判定产出完赛时间与评级，名次与完赛时间自洽（B5-2）', async () => {
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
      const r = started.body as {
        raceId: string;
        rank: number;
        totalRacers: number;
        finishTime: number;
        grade: string;
        opponentFinishTimes: number[];
        ghostSource: string;
      };

      expect(r.finishTime).toBeGreaterThan(0);
      expect(['S', 'A', 'B', 'C']).toContain(r.grade);
      expect(['player', 'mixed', 'npc']).toContain(r.ghostSource);
      expect(r.opponentFinishTimes).toHaveLength(r.totalRacers - 1);
      // 名次 = 1 + 跑得比自己快的对手数
      const faster = r.opponentFinishTimes.filter(
        (t) => t < r.finishTime,
      ).length;
      expect(r.rank).toBe(faster + 1);

      // 结算回传同一份完赛时间与评级
      const settled = await request(server)
        .post('/race/settle')
        .set(auth)
        .send({ bizId: biz('race-settle'), raceId: r.raceId })
        .expect(201);
      const s = settled.body as { finishTime: number; grade: string };
      expect(s.finishTime).toBe(r.finishTime);
      expect(s.grade).toBe(r.grade);
    });

    it('心情差跑得更慢（mood 进入判定，B5-2）', async () => {
      const happy = await e2e.createPlayer();
      const sad = await e2e.createPlayer();

      const times: Record<string, number> = {};
      for (const [tag, p] of [
        ['happy', happy],
        ['sad', sad],
      ] as const) {
        const auth = { Authorization: `Bearer ${p.token}` };
        await request(server)
          .post('/pet/create')
          .set(auth)
          .send({ bizId: biz('create') })
          .expect(201);
        // 直接压库改心情：接口不接受客户端上报数值
        await e2e.setPetMood(p.userId, tag === 'happy' ? 100 : 0);

        const res = await request(server)
          .post('/race/start')
          .set(auth)
          .send({ bizId: biz('race-start'), trackKey: 'meadow' })
          .expect(201);
        times[tag] = (res.body as { finishTime: number }).finishTime;
      }

      // ±5% 扰动远小于心情带来的 ~25% 差距，这个断言不会偶发翻转
      expect(times.sad).toBeGreaterThan(times.happy);
    });

    it('结算推进「完成赛跑」每日任务，重复结算不再推进（B5-5）', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };
      await request(server)
        .post('/pet/create')
        .set(auth)
        .send({ bizId: biz('create') })
        .expect(201);

      type DailyRes = { tasks: { key: string; progress: number }[] };
      const before = await request(server).get('/daily').set(auth).expect(200);
      expect(
        (before.body as DailyRes).tasks.find((t) => t.key === 'race')?.progress,
      ).toBe(0);

      const started = await request(server)
        .post('/race/start')
        .set(auth)
        .send({ bizId: biz('race-start'), trackKey: 'meadow' })
        .expect(201);
      const raceId = (started.body as { raceId: string }).raceId;
      await request(server)
        .post('/race/settle')
        .set(auth)
        .send({ bizId: biz('race-settle'), raceId })
        .expect(201);

      const after = await request(server).get('/daily').set(auth).expect(200);
      expect(
        (after.body as DailyRes).tasks.find((t) => t.key === 'race')?.progress,
      ).toBe(1);

      // 重复结算走回放，不能把任务刷到 2
      await request(server)
        .post('/race/settle')
        .set(auth)
        .send({ bizId: biz('race-settle-2'), raceId })
        .expect(201);
      const again = await request(server).get('/daily').set(auth).expect(200);
      expect(
        (again.body as DailyRes).tasks.find((t) => t.key === 'race')?.progress,
      ).toBe(1);
    });
  });

  describe('图鉴收集类条目（B5-1）', () => {
    it('买皮肤点亮收集图鉴，达标后可领奖', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };
      await request(server)
        .post('/pet/create')
        .set(auth)
        .send({ bizId: biz('create') })
        .expect(201);
      await e2e.fundWallet(p.userId, { game: 5000 });

      type DexRes = {
        entries: { key: string; progress: number; unlocked: boolean }[];
      };
      const before = await request(server).get('/dex').set(auth).expect(200);
      const skinBefore = (before.body as DexRes).entries.find(
        (e) => e.key === 'skin3',
      );
      expect(skinBefore?.progress).toBe(0);

      // 三种皮肤：skin_default 免费但走不到 buy（price=0 会被拒），故买两款付费皮肤
      for (const key of ['skin_snow', 'skin_tiger']) {
        await request(server)
          .post('/items/wardrobe/buy')
          .set(auth)
          .send({ bizId: biz(`buy-${key}`), itemKey: key })
          .expect(201);
      }

      const mid = await request(server).get('/dex').set(auth).expect(200);
      const skinMid = (mid.body as DexRes).entries.find(
        (e) => e.key === 'skin3',
      );
      expect(skinMid?.progress).toBe(2);
      expect(skinMid?.unlocked).toBe(false);

      // 未达标不能领
      await request(server)
        .post('/dex/claim')
        .set(auth)
        .send({ bizId: biz('dex-early'), entryKey: 'skin3' })
        .expect(400);

      // 补第三种（背景也算 accessory，这里再买一款皮肤凑齐）
      await request(server)
        .post('/items/wardrobe/buy')
        .set(auth)
        .send({ bizId: biz('buy-bg'), itemKey: 'bg_garden' })
        .expect(201);

      const afterAcc = await request(server).get('/dex').set(auth).expect(200);
      const accEntry = (afterAcc.body as DexRes).entries.find(
        (e) => e.key === 'acc3',
      );
      // 背景走 accessory 类型，所以点亮的是配饰收集而非皮肤收集
      expect(accEntry?.progress).toBe(1);
      expect(
        (afterAcc.body as DexRes).entries.find((e) => e.key === 'skin3')
          ?.progress,
      ).toBe(2);

      // 跨类型合计条目按总种类数推进
      expect(
        (afterAcc.body as DexRes).entries.find((e) => e.key === 'collect10')
          ?.progress,
      ).toBe(3);
    });

    it('家具收集达标可领奖，且奖励幂等（bizId 服务端派生）', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };
      await request(server)
        .post('/pet/create')
        .set(auth)
        .send({ bizId: biz('create') })
        .expect(201);
      await e2e.fundWallet(p.userId, { game: 5000 });

      for (const key of ['furn_mat', 'furn_sofa', 'furn_lamp', 'furn_tree']) {
        await request(server)
          .post('/home/buy')
          .set(auth)
          .send({ bizId: biz(`buy-${key}`), itemKey: key })
          .expect(201);
      }

      const claimed = await request(server)
        .post('/dex/claim')
        .set(auth)
        .send({ bizId: biz('dex-furn'), entryKey: 'furn4' })
        .expect(201);
      expect((claimed.body as { gained: number }).gained).toBe(200);

      // 再领：换 bizId 也拿不到第二份
      await request(server)
        .post('/dex/claim')
        .set(auth)
        .send({ bizId: biz('dex-furn-2'), entryKey: 'furn4' })
        .expect(400);
    });
  });

  describe('家园网格（B5-4）', () => {
    it('越界摆放被拒、重叠摆放被拒、省略坐标自动寻位', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };
      await request(server)
        .post('/pet/create')
        .set(auth)
        .send({ bizId: biz('create') })
        .expect(201);
      await e2e.fundWallet(p.userId, { game: 5000 });

      // 暖垫占 2×2
      await request(server)
        .post('/home/buy')
        .set(auth)
        .send({ bizId: biz('buy-mat'), itemKey: 'furn_mat' })
        .expect(201);
      await request(server)
        .post('/home/buy')
        .set(auth)
        .send({ bizId: biz('buy-mat2'), itemKey: 'furn_mat' })
        .expect(201);

      type HomeRes = {
        grid: { width: number; height: number };
        placed: { posX: number; posY: number; gridW: number; gridH: number }[];
      };
      const home = await request(server).get('/home').set(auth).expect(200);
      expect((home.body as HomeRes).grid).toEqual({ width: 6, height: 6 });

      // 6×6 里 2×2 家具左上角最多到 (4,4)；(5,5) 越界
      await request(server)
        .post('/home/place')
        .set(auth)
        .send({ itemKey: 'furn_mat', posX: 5, posY: 5 })
        .expect(400);

      const placed = await request(server)
        .post('/home/place')
        .set(auth)
        .send({ itemKey: 'furn_mat', posX: 0, posY: 0 })
        .expect(201);
      expect((placed.body as HomeRes).placed).toHaveLength(1);

      // 与已摆放的 (0,0)-(2,2) 重叠
      await request(server)
        .post('/home/place')
        .set(auth)
        .send({ itemKey: 'furn_mat', posX: 1, posY: 1 })
        .expect(400);

      // 省略坐标：自动挪到不重叠的位置
      const auto = await request(server)
        .post('/home/place')
        .set(auth)
        .send({ itemKey: 'furn_mat' })
        .expect(201);
      const rects = (auto.body as HomeRes).placed;
      expect(rects).toHaveLength(2);
      const second = rects.find((r) => !(r.posX === 0 && r.posY === 0));
      expect(second).toBeDefined();
      expect(second!.gridW).toBe(2);
    });
  });

  describe('背景穿戴部位（B5-7）', () => {
    it('bg 槽位可买可穿，且与 hat 槽互不覆盖', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };
      const created = await request(server)
        .post('/pet/create')
        .set(auth)
        .send({ bizId: biz('create') })
        .expect(201);
      const petId = (created.body as { pet: { id: string } }).pet.id;
      await e2e.fundWallet(p.userId, { game: 5000 });

      for (const key of ['bg_garden', 'acc_cap']) {
        await request(server)
          .post('/items/wardrobe/buy')
          .set(auth)
          .send({ bizId: biz(`buy-${key}`), itemKey: key })
          .expect(201);
      }
      await request(server)
        .post('/items/wardrobe/equip')
        .set(auth)
        .send({ itemKey: 'bg_garden', petId })
        .expect(201);
      const res = await request(server)
        .post('/items/wardrobe/equip')
        .set(auth)
        .send({ itemKey: 'acc_cap', petId })
        .expect(201);

      const equipped = (res.body as { equipped: Record<string, string> })
        .equipped;
      expect(equipped.bg).toBe('bg_garden');
      expect(equipped.hat).toBe('acc_cap');
    });
  });

  describe('广告奖励（A2 凭证核销）', () => {
    it('不带凭证：400 且一分不发', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };

      await request(server)
        .post('/boost/ad/verify')
        .set(auth)
        .send({ bizId: biz('ad') })
        .expect(400);
      expect((await e2e.walletOf(p.userId)).gameCoin).toBe(0);
    });

    it('伪造凭证：400', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };

      await request(server)
        .post('/boost/ad/verify')
        .set(auth)
        .send({ bizId: biz('ad'), adToken: 'forged-nonce' })
        .expect(400);
      expect((await e2e.walletOf(p.userId)).gameCoin).toBe(0);
    });

    it('领凭证→核销：发币；同一枚凭证不能用第二次', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };

      const issued = await request(server)
        .post('/boost/ad/token')
        .set(auth)
        .send({ scene: 'ad_reward' })
        .expect(201);
      const { nonce } = issued.body as { nonce: string };
      expect(nonce).toBeTruthy();

      const ok = await request(server)
        .post('/boost/ad/verify')
        .set(auth)
        .send({ bizId: biz('ad-1'), adToken: nonce })
        .expect(201);
      const gained = (ok.body as { gained: number }).gained;
      expect(gained).toBeGreaterThan(0);
      expect((await e2e.walletOf(p.userId)).gameCoin).toBe(gained);

      // 凭证是一次性的：换新 bizId 复用同一枚也不行
      await request(server)
        .post('/boost/ad/verify')
        .set(auth)
        .send({ bizId: biz('ad-2'), adToken: nonce })
        .expect(400);
      expect((await e2e.walletOf(p.userId)).gameCoin).toBe(gained);
    });

    // 回归 P0-3：签发侧的每日上限必须原子。并发领券时成功数必须恰好等于配置上限，
    // 而不是被 check-then-act 的竞态放大。修复前（GET 判断 + INCR 分两条命令）此断言必挂。
    it('并发领券：成功数恰等于每日上限，不超发', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };
      const scene = 'race_double';

      // 清掉限流计数，保证这一波并发不会撞上 @nestjs/throttler 的 429
      await e2e.resetThrottle();

      const cfg = await e2e.app.get(GameConfigService).get('boost.ad_token');
      const cap = cfg.dailyCapPerScene;
      const burst = cap + 6; // 超过上限，逼出竞态

      const results = await Promise.all(
        Array.from({ length: burst }, () =>
          request(server).post('/boost/ad/token').set(auth).send({ scene }),
        ),
      );

      const ok = results.filter((r) => r.status === 201);
      const rejected = results.filter((r) => r.status === 400);

      // 核心断言：成功数不多不少，正好等于上限
      expect(ok.length).toBe(cap);
      expect(rejected.length).toBe(burst - cap);

      // 每枚成功凭证的 nonce 互不相同（没有两个请求领到同一枚）
      const nonces = new Set(
        ok.map((r) => (r.body as { nonce: string }).nonce),
      );
      expect(nonces.size).toBe(cap);

      // Redis 侧的日计数也应恰好停在上限，而非被超发抬高
      const capKeys = await e2e.redis.keys(
        `adtoken:cap:${p.userId}:*:${scene}`,
      );
      expect(capKeys).toHaveLength(1);
      expect(Number(await e2e.redis.get(capKeys[0]))).toBe(cap);
    });
  });

  describe('付费增值：加速清冷却 / 恢复体力', () => {
    it('加速：扣费并清掉互动冷却，同 bizId 重放不二次扣费', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };
      await e2e.fundWallet(p.userId, { game: 1000 });

      await request(server)
        .post('/pet/create')
        .set(auth)
        .send({ bizId: biz('create') })
        .expect(201);
      // 喂食会写下该动作的冷却，给加速一个真实可清的目标
      await request(server)
        .post('/pet/feed')
        .set(auth)
        .send({ bizId: biz('feed') })
        .expect(201);

      const before = await e2e.walletOf(p.userId);
      const bizId = biz('speedup');
      const res = await request(server)
        .post('/boost/speedup')
        .set(auth)
        .send({ bizId })
        .expect(201);

      const body = res.body as { cleared: number; gameCoin: number };
      expect(body.cleared).toBeGreaterThan(0);
      const after = await e2e.walletOf(p.userId);
      expect(after.gameCoin).toBeLessThan(before.gameCoin);
      expect(after.gameCoin).toBe(body.gameCoin);

      // 幂等：同一 bizId 重放只回放结果，不再扣一次
      await request(server)
        .post('/boost/speedup')
        .set(auth)
        .send({ bizId })
        .expect(201);
      expect((await e2e.walletOf(p.userId)).gameCoin).toBe(after.gameCoin);
    });

    it('恢复体力：扣费并把体力回到当前等级上限', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };
      await e2e.fundWallet(p.userId, { game: 1000 });

      const created = await request(server)
        .post('/pet/create')
        .set(auth)
        .send({ bizId: biz('create') })
        .expect(201);
      const petId = (created.body as { pet: { id: string } }).pet.id;

      // 直接压低体力：race 之类的消耗路径会牵进赛道配置，这里只想验证恢复本身
      await e2e.db.query(`UPDATE pet SET stamina = 1 WHERE id = $1`, [petId]);

      const before = await e2e.walletOf(p.userId);
      const res = await request(server)
        .post('/boost/stamina/recover')
        .set(auth)
        .send({ bizId: biz('recover') })
        .expect(201);

      const body = res.body as {
        pet: { stamina: number; staminaMax: number };
        gameCoin: number;
      };
      expect(body.pet.stamina).toBe(body.pet.staminaMax);
      const after = await e2e.walletOf(p.userId);
      expect(after.gameCoin).toBeLessThan(before.gameCoin);
      expect(after.gameCoin).toBe(body.gameCoin);
    });

    it('余额不足：两个端点都拒绝，且一分不扣', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };
      await request(server)
        .post('/pet/create')
        .set(auth)
        .send({ bizId: biz('create') })
        .expect(201);

      await request(server)
        .post('/boost/speedup')
        .set(auth)
        .send({ bizId: biz('speedup-poor') })
        .expect(400);
      await request(server)
        .post('/boost/stamina/recover')
        .set(auth)
        .send({ bizId: biz('recover-poor') })
        .expect(400);

      expect((await e2e.walletOf(p.userId)).gameCoin).toBe(0);
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

    it('目录带出剩余库存与本人可兑余量（B1）', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };

      const res = await request(server).get('/exchange').set(auth).expect(200);
      const { items } = res.body as {
        items: {
          key: string;
          stockLeft: number | null;
          myLeft: number | null;
        }[];
      };

      const plush = items.find((i) => i.key === 'plush_toy');
      expect(plush?.stockLeft).not.toBeNull();
      expect(plush?.myLeft).toBe(1);
      // 虚拟券默认不限量，两个余量都是 null
      const coupon = items.find((i) => i.key === 'coupon_5');
      expect(coupon?.stockLeft).toBeNull();
      expect(coupon?.myLeft).toBeNull();
    });

    it('每人限购拦第二单，且被拒时不扣积分（B1）', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };
      await e2e.fundWallet(p.userId, { marketing: 5000 });

      const addr = await request(server)
        .post('/exchange/address')
        .set(auth)
        .send({
          receiver: '测试',
          phone: '13800000000',
          region: '广东省/深圳市',
          detail: '测试地址 1 号',
          isDefault: true,
        })
        .expect(201);
      const addressId = String(
        (addr.body as { address: { id: string | number } }).address.id,
      );

      await request(server)
        .post('/exchange/redeem')
        .set(auth)
        .send({ bizId: biz('plush-1'), exchangeKey: 'plush_toy', addressId })
        .expect(201);
      const afterFirst = await e2e.walletOf(p.userId);

      const second = await request(server)
        .post('/exchange/redeem')
        .set(auth)
        .send({ bizId: biz('plush-2'), exchangeKey: 'plush_toy', addressId });
      expect(second.status).toBe(400);
      expect((second.body as { message: string }).message).toContain('限兑');
      // 关键：限购判断在扣费之前，被拒时余额一分不动
      expect((await e2e.walletOf(p.userId)).marketingPoint).toBe(
        afterFirst.marketingPoint,
      );
    });
  });

  describe('兑换中心：game 池虚拟品即时到账', () => {
    /**
     * 这条是**回归测试**。此前 `autoFulfill` 调的是带锁的 `ItemsService.grant`，
     * 而它自己已在 `pet:{userId}` 锁内 —— Redis 锁不可重入，抢锁超时抛 409，
     * 又被 autoFulfill 的 catch 吞掉，于是订单永远落 pending：
     * 「即时到账」这个功能从上线起就没生效过，且日志之外毫无迹象。
     */
    it('兑换后订单直接 shipped，且道具当场进背包', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };
      await e2e.fundWallet(p.userId, { game: 5000 });

      const res = await request(server)
        .post('/exchange/redeem')
        .set(auth)
        .send({ bizId: biz('snack-pack'), exchangeKey: 'snack_pack' })
        .expect(201);
      const order = (
        res.body as { order: { status: string; shippedAt: string | null } }
      ).order;
      expect(order.status).toBe('shipped');
      expect(order.shippedAt).not.toBeNull();

      const owned = await request(server)
        .get('/items/consumables')
        .set(auth)
        .expect(200);
      const snack = (
        owned.body as { items: { key: string; owned: number }[] }
      ).items.find((i) => i.key === 'cons_snack');
      expect(snack?.owned).toBe(10);
    });

    it('实物兑换仍留 pending 等运营发货，不会被自动发放误伤', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };
      await e2e.fundWallet(p.userId, { marketing: 5000 });

      const addr = await request(server)
        .post('/exchange/address')
        .set(auth)
        .send({
          receiver: '测试',
          phone: '13800000000',
          region: '广东省/深圳市',
          detail: '测试地址 2 号',
          isDefault: true,
        })
        .expect(201);
      const addressId = String(
        (addr.body as { address: { id: string | number } }).address.id,
      );

      const res = await request(server)
        .post('/exchange/redeem')
        .set(auth)
        .send({ bizId: biz('phys'), exchangeKey: 'plush_toy', addressId })
        .expect(201);
      expect((res.body as { order: { status: string } }).order.status).toBe(
        'pending',
      );
    });
  });

  describe('消耗品：买 → 用 → 生效', () => {
    it('买入后使用，饱食度上升、持有量减少、余额按目录价扣', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };
      await e2e.fundWallet(p.userId, { game: 5000 });
      await request(server)
        .post('/pet/create')
        .set(auth)
        .send({ bizId: biz('cons-pet'), species: 'cat', nickname: '消耗测试' })
        .expect(201);

      const shop = await request(server)
        .get('/items/consumables')
        .set(auth)
        .expect(200);
      const snack = (
        shop.body as {
          items: { key: string; price: number; owned: number }[];
        }
      ).items.find((i) => i.key === 'cons_snack');
      expect(snack).toBeDefined();
      expect(snack?.owned).toBe(0);

      const bought = await request(server)
        .post('/items/consumables/buy')
        .set(auth)
        .send({ itemKey: 'cons_snack', qty: 3, bizId: biz('cons-buy') })
        .expect(201);
      expect((bought.body as { qty: number }).qty).toBe(3);
      expect((await e2e.walletOf(p.userId)).gameCoin).toBe(
        5000 - (snack?.price ?? 0) * 3,
      );

      // 先把饱食度压低，否则封顶会让「用了没变化」与「没生效」无法区分
      await e2e.db.query(
        `UPDATE pet SET hunger = 40, last_seen_at = now() WHERE user_id = $1`,
        [p.userId],
      );

      const used = await request(server)
        .post('/items/consumables/use')
        .set(auth)
        .send({ itemKey: 'cons_snack', bizId: biz('cons-use') })
        .expect(201);
      const body = used.body as {
        left: number;
        pet: { hunger: number };
      };
      expect(body.left).toBe(2);
      expect(body.pet.hunger).toBeGreaterThan(40);
    });

    it('没有持有量时使用被拒（400），不会凭空生效', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };
      await request(server)
        .post('/pet/create')
        .set(auth)
        .send({ bizId: biz('cons-none-pet'), species: 'cat' })
        .expect(201);

      const res = await request(server)
        .post('/items/consumables/use')
        .set(auth)
        .send({ itemKey: 'cons_snack', bizId: biz('cons-none') });
      expect(res.status).toBe(400);
    });

    it('拿皮肤走消耗品入口被拒（404），不能绕开换装的槽位校验', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };
      await e2e.fundWallet(p.userId, { game: 5000 });

      await request(server)
        .post('/items/consumables/buy')
        .set(auth)
        .send({ itemKey: 'skin_snow', bizId: biz('cons-wrong') })
        .expect(404);
    });
  });

  describe('扭蛋：概率公示 / 幂等 / 保底', () => {
    it('GET /gacha 公示每档概率，合计 100%', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };

      const res = await request(server).get('/gacha').set(auth).expect(200);
      const pools = (
        res.body as {
          pools: {
            key: string;
            cost: number;
            odds: { percent: number }[];
          }[];
        }
      ).pools;
      expect(pools.length).toBeGreaterThan(0);
      for (const pool of pools) {
        const sum = pool.odds.reduce((a, o) => a + o.percent, 0);
        expect(sum).toBeCloseTo(100, 2);
      }
    });

    it('单抽扣费、产出到账，且同 bizId 重放不重掷不重扣', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };
      await e2e.fundWallet(p.userId, { game: 20_000 });

      const pools = await request(server).get('/gacha').set(auth).expect(200);
      const pool = (pools.body as { pools: { key: string; cost: number }[] })
        .pools[0];

      const bizId = biz('gacha-one');
      const first = await request(server)
        .post('/gacha/draw')
        .set(auth)
        .send({ poolKey: pool.key, times: 1, bizId })
        .expect(201);
      const one = first.body as {
        prizes: { entryKey: string }[];
        duplicated: boolean;
        cost: number;
      };
      expect(one.prizes).toHaveLength(1);
      expect(one.duplicated).toBe(false);
      expect(one.cost).toBe(pool.cost);
      const afterFirst = await e2e.walletOf(p.userId);

      // 幂等拦截器在 Redis 命中就会直接回放，这里换一次请求也要保证结果一致
      const replay = await request(server)
        .post('/gacha/draw')
        .set(auth)
        .send({ poolKey: pool.key, times: 1, bizId })
        .expect(201);
      const again = replay.body as { prizes: { entryKey: string }[] };
      expect(again.prizes.map((x) => x.entryKey)).toEqual(
        one.prizes.map((x) => x.entryKey),
      );
      expect((await e2e.walletOf(p.userId)).gameCoin).toBe(afterFirst.gameCoin);

      // 落库只有一条，证明没有重掷
      const rows = await e2e.db.query<{ n: string }[]>(
        `SELECT count(*) n FROM gacha_draw WHERE user_id = $1 AND biz_id = $2`,
        [p.userId, bizId],
      );
      expect(Number(rows[0].n)).toBe(1);
    });

    it('十连按 costTen 计价，出 10 档产出，并推进保底计数', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };
      await e2e.fundWallet(p.userId, { game: 50_000 });

      const pools = await request(server).get('/gacha').set(auth).expect(200);
      const pool = (pools.body as { pools: { key: string; costTen: number }[] })
        .pools[0];

      const res = await request(server)
        .post('/gacha/draw')
        .set(auth)
        .send({ poolKey: pool.key, times: 10, bizId: biz('gacha-ten') })
        .expect(201);
      const ten = res.body as {
        prizes: unknown[];
        cost: number;
        pity: number;
      };
      expect(ten.prizes).toHaveLength(10);
      expect(ten.cost).toBe(pool.costTen);

      const state = await e2e.db.query<{ total_draws: number }[]>(
        `SELECT total_draws FROM gacha_state WHERE user_id = $1`,
        [p.userId],
      );
      expect(Number(state[0].total_draws)).toBe(10);
    });

    it('余额不足时拒绝，且不落抽奖记录', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };
      await e2e.fundWallet(p.userId, { game: 1 });

      const pools = await request(server).get('/gacha').set(auth).expect(200);
      const pool = (pools.body as { pools: { key: string }[] }).pools[0];

      const res = await request(server)
        .post('/gacha/draw')
        .set(auth)
        .send({ poolKey: pool.key, times: 1, bizId: biz('gacha-poor') });
      expect(res.status).toBe(400);

      const rows = await e2e.db.query<{ n: string }[]>(
        `SELECT count(*) n FROM gacha_draw WHERE user_id = $1`,
        [p.userId],
      );
      expect(Number(rows[0].n)).toBe(0);
    });

    it('只接受 1 抽或 10 连', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };
      await e2e.fundWallet(p.userId, { game: 20_000 });

      await request(server)
        .post('/gacha/draw')
        .set(auth)
        .send({ poolKey: 'daily', times: 3, bizId: biz('gacha-bad') })
        .expect(400);
    });

    it('封禁玩家不能抽', async () => {
      const p = await e2e.createPlayer({ status: 'banned' });
      const auth = { Authorization: `Bearer ${p.token}` };

      await request(server)
        .post('/gacha/draw')
        .set(auth)
        .send({ poolKey: 'daily', times: 1, bizId: biz('gacha-banned') })
        .expect(403);
    });
  });

  describe('兑换码：营销积分的玩家侧入口', () => {
    /**
     * 生码字符集必须与 `promo.config` 的 ALPHABET 一致（去掉了 0/O/1/I/L/U）：
     * 玩家提交的码会先过 `normalizeCode` 过滤非字符集字符，
     * 用 base36 随机串造码会被过滤掉 0/1/O/L 等位，查库自然找不到。
     */
    const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

    /** 直接插码：后台建码要过 RBAC，这里只测玩家侧兑换链路。 */
    async function makeCode(
      amount: number,
      opts: { maxUses?: number; enabled?: boolean } = {},
    ): Promise<{ id: string; code: string }> {
      let code = '';
      for (let i = 0; i < 12; i += 1) {
        code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
      }
      const rows = await e2e.db.query<{ id: string }[]>(
        `INSERT INTO promo_code (code, batch, pool, amount, max_uses, enabled)
         VALUES ($1, 'e2e', 'marketing', $2, $3, $4) RETURNING id`,
        [code, amount, opts.maxUses ?? 1, opts.enabled ?? true],
      );
      codeIds.push(rows[0].id);
      return { id: rows[0].id, code };
    }

    const codeIds: string[] = [];
    afterAll(async () => {
      // 兑换记录由 teardown 按 user 清；码本身不挂 user，得自己收
      for (const id of codeIds) {
        await e2e.db.query(`DELETE FROM promo_redemption WHERE code_id = $1`, [
          id,
        ]);
        await e2e.db.query(`DELETE FROM promo_code WHERE id = $1`, [id]);
      }
    }, 30_000);

    it('兑换后营销积分到账，同一码同一人重提走幂等回放而非二次入账', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };
      const { code } = await makeCode(500, { maxUses: 5 });

      await request(server)
        .post('/promo/redeem')
        .set(auth)
        .send({ code, bizId: biz('promo-1') })
        .expect(201);
      expect((await e2e.walletOf(p.userId)).marketingPoint).toBe(500);

      /*
       * 重提**不报错**是刻意设计（见 PromoService 类注释）：领用与入账是两步，
       * 若入账那步失败，玩家重提同一个码要能命中已有的领用记录、重走入账把钱补上。
       * 改成 400 会把这条自愈路径掐掉 —— 玩家会永久卡在「次数已消耗、积分没到账」。
       *
       * 真正要守住的不变量是**不能二次入账**，所以断言落在 duplicated 与余额上。
       */
      const second = await request(server)
        .post('/promo/redeem')
        .set(auth)
        .send({ code, bizId: biz('promo-2') })
        .expect(201);
      expect((second.body as { duplicated: boolean }).duplicated).toBe(true);
      expect((await e2e.walletOf(p.userId)).marketingPoint).toBe(500);
    });

    it('码不存在时拒绝（404），且不记账', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };

      const res = await request(server)
        .post('/promo/redeem')
        .set(auth)
        .send({ code: 'ZZZZZZZZZZZZ', bizId: biz('promo-none') });
      expect(res.status).toBe(404);
      // 提示刻意含糊：区分「不存在」和「已失效」等于给爆破者一个探测器
      expect((res.body as { message: string }).message).toContain('无效');
      expect((await e2e.walletOf(p.userId)).marketingPoint).toBe(0);
    });

    it('已停用的码不能兑', async () => {
      const p = await e2e.createPlayer();
      const auth = { Authorization: `Bearer ${p.token}` };
      const { code } = await makeCode(300, { enabled: false });

      await request(server)
        .post('/promo/redeem')
        .set(auth)
        .send({ code, bizId: biz('promo-off') })
        .expect(400);
      expect((await e2e.walletOf(p.userId)).marketingPoint).toBe(0);
    });

    it('用完次数的码不能再兑（第二个人被拒）', async () => {
      const { code } = await makeCode(200, { maxUses: 1 });
      const a = await e2e.createPlayer();
      const b = await e2e.createPlayer();

      await request(server)
        .post('/promo/redeem')
        .set({ Authorization: `Bearer ${a.token}` })
        .send({ code, bizId: biz('promo-a') })
        .expect(201);

      const second = await request(server)
        .post('/promo/redeem')
        .set({ Authorization: `Bearer ${b.token}` })
        .send({ code, bizId: biz('promo-b') });
      expect(second.status).toBe(400);
      expect((await e2e.walletOf(b.userId)).marketingPoint).toBe(0);
    });
  });
});
