import { Server } from 'node:http';
import request from 'supertest';
import { E2eApp } from './helpers/e2e-app';

/**
 * 玩法扩展 e2e（连真库）：覆盖本次新增端点的跨模块接线（守卫链 / 幂等 / 锁 / 记账 / 配置）。
 * 数据纪律同主链路：数据挂临时 e2e_ 用户，跑完删净；仅本文件自建的 game_event 行手动清理。
 */
describe('玩法扩展 (e2e, 连真库)', () => {
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
  const authOf = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function playerWithPet() {
    const p = await e2e.createPlayer();
    const auth = authOf(p.token);
    await request(server)
      .post('/pet/create')
      .set(auth)
      .send({ bizId: biz('pet') })
      .expect(201);
    return { ...p, auth };
  }

  it('普通 application/json 请求体能被解析（守住 bootstrap 装配）', async () => {
    // supertest 的 .send(object) 发的就是 application/json，与真实客户端一致。
    // main.ts 曾用 useBodyParser 注册 CSP 专用类型，把 Nest 的默认 json 解析器
    // 一并顶掉，线上每个写接口的 req.body 恒为空、一律 400；
    // 而当时 e2e 夹具自己手拼装配、不含那段注册，143 个用例照样全绿。
    const p = await e2e.createPlayer();
    await request(server)
      .post('/pet/create')
      .set(authOf(p.token))
      .send({ bizId: biz('bodyparser') })
      .expect(201);
  });

  describe('P10 特质 / P1 疾病', () => {
    it('新建宠物带随机特质；conditions 纯读；无病治疗报错', async () => {
      const p = await playerWithPet();
      const state = await request(server)
        .get('/pet/state')
        .set(p.auth)
        .expect(200);
      const pet = (
        state.body as {
          pet: { traits: unknown[]; form: string; rarity: string };
        }
      ).pet;
      expect(Array.isArray(pet.traits)).toBe(true);
      expect(pet.form).toBe('normal');
      expect(pet.rarity).toBe('common');

      const cond = await request(server)
        .get('/pet/conditions')
        .set(p.auth)
        .expect(200);
      expect((cond.body as { conditions: unknown[] }).conditions).toEqual([]);

      const cure = await request(server)
        .post('/pet/cure')
        .set(p.auth)
        .send({ bizId: biz('cure'), method: 'clinic' });
      expect(cure.status).toBe(400);
    });
  });

  describe('P13 训练技巧', () => {
    it('tricks 列表 200；陪玩次数不足无法学习', async () => {
      const p = await playerWithPet();
      const list = await request(server)
        .get('/training/tricks')
        .set(p.auth)
        .expect(200);
      expect((list.body as { total: number }).total).toBeGreaterThan(0);

      const practice = await request(server)
        .post('/training/practice')
        .set(p.auth)
        .send({ bizId: biz('prac'), trickKey: 'sit' });
      expect(practice.status).toBe(400);
    });
  });

  describe('P11 小游戏', () => {
    it('list / start / settle 打通并发币', async () => {
      const p = await playerWithPet();
      const list = await request(server)
        .get('/minigame/list')
        .set(p.auth)
        .expect(200);
      expect((list.body as { total: number }).total).toBeGreaterThan(0);

      const start = await request(server)
        .post('/minigame/start')
        .set(p.auth)
        .send({ bizId: biz('mg-start'), gameKey: 'catch' })
        .expect(201);
      const sessionId = (
        start.body as { session: { id: string; seed: string } }
      ).session.id;
      expect(
        (start.body as { session: { seed: string } }).session.seed,
      ).toHaveLength(64);

      const settle = await request(server)
        .post('/minigame/settle')
        .set(p.auth)
        .send({
          bizId: biz('mg-settle'),
          sessionId,
          actions: [
            { t: 100, x: 0.5 },
            { t: 200, x: 0.3 },
          ],
        })
        .expect(201);
      const body = settle.body as {
        score: number;
        rewardCoin: number;
        wallet: { gameCoin: number };
      };
      expect(body.score).toBeGreaterThanOrEqual(0);
      expect(body.wallet).toBeDefined();
    });
  });

  describe('P7 兽医', () => {
    it('unlock / case / diagnose 打通；answer_key 不泄漏', async () => {
      const p = await playerWithPet();
      await e2e.fundWallet(p.userId, { game: 6000 });

      await request(server)
        .post('/clinic/unlock')
        .set(p.auth)
        .send({ bizId: biz('clinic-unlock') })
        .expect(201);

      const caseRes = await request(server)
        .get('/clinic/case')
        .set(p.auth)
        .expect(200);
      const kase = (caseRes.body as { case: Record<string, unknown> }).case;
      expect(kase).toBeDefined();
      expect(kase.answerKey).toBeUndefined();
      expect(kase.answer_key).toBeUndefined();
      const options = kase.options as { key: string }[];
      expect(options.length).toBeGreaterThan(0);

      const diag = await request(server)
        .post('/clinic/diagnose')
        .set(p.auth)
        .send({
          bizId: biz('diag'),
          caseId: kase.id,
          optionKey: options[0].key,
        })
        .expect(201);
      expect(
        (diag.body as { clinic: { totalCount: number } }).clinic.totalCount,
      ).toBe(1);
    });
  });

  describe('P9 社交', () => {
    it('访问他人家园 + 点赞发币，重复点赞幂等', async () => {
      const a = await playerWithPet();
      const b = await playerWithPet();

      const visit = await request(server)
        .get(`/home/visit/${b.userId}`)
        .set(a.auth)
        .expect(200);
      expect((visit.body as { likedToday: boolean }).likedToday).toBe(false);

      const like1 = await request(server)
        .post('/home/like')
        .set(a.auth)
        .send({ bizId: biz('like'), userId: b.userId })
        .expect(201);
      expect((like1.body as { gained: number }).gained).toBeGreaterThan(0);

      const like2 = await request(server)
        .post('/home/like')
        .set(a.auth)
        .send({ bizId: biz('like2'), userId: b.userId })
        .expect(201);
      expect((like2.body as { duplicated: boolean }).duplicated).toBe(true);
      expect((like2.body as { gained: number }).gained).toBe(0);
    });
  });

  describe('P4 异步 PvP', () => {
    it('challenge 结算 + rank + history；opponents 200', async () => {
      const a = await playerWithPet();
      const b = await playerWithPet();

      const chal = await request(server)
        .post('/pvp/challenge')
        .set(a.auth)
        .send({
          bizId: biz('chal'),
          opponentUserId: b.userId,
          trackKey: 'meadow',
        })
        .expect(201);
      const body = chal.body as {
        match: { challengerTime: number; opponentTime: number };
        rank: { rankPoint: number };
        wallet: { gameCoin: number };
      };
      expect(body.match.challengerTime).toBeGreaterThan(0);
      expect(body.rank.rankPoint).toBeGreaterThan(0);

      const rank = await request(server)
        .get('/pvp/rank')
        .set(a.auth)
        .expect(200);
      expect((rank.body as { me: { rankPoint: number } }).me).toBeDefined();

      await request(server).get('/pvp/opponents').set(a.auth).expect(200);
      const hist = await request(server)
        .get('/pvp/history')
        .set(a.auth)
        .expect(200);
      expect((hist.body as { total: number }).total).toBeGreaterThanOrEqual(1);
    });
  });

  describe('P8 融合', () => {
    it('preview 单只无配方返回 ok:false（不抛 400）', async () => {
      const p = await playerWithPet();
      const state = await request(server)
        .get('/pet/state')
        .set(p.auth)
        .expect(200);
      const petId = (state.body as { pet: { id: string } }).pet.id;
      const prev = await request(server)
        .post('/fusion/preview')
        .set(p.auth)
        .send({ petIds: [petId] })
        .expect(201);
      expect((prev.body as { ok: boolean }).ok).toBe(false);
    });
  });

  describe('P3 繁殖', () => {
    it('未成年不能繁殖；eggs 列表 200', async () => {
      const p = await e2e.createPlayer();
      const auth = authOf(p.token);
      const c1 = await request(server)
        .post('/pet/create')
        .set(auth)
        .send({ bizId: biz('b1') })
        .expect(201);
      const c2 = await request(server)
        .post('/pet/create')
        .set(auth)
        .send({ bizId: biz('b2') })
        .expect(201);
      const id1 = (c1.body as { pet: { id: string } }).pet.id;
      const id2 = (c2.body as { pet: { id: string } }).pet.id;
      await e2e.fundWallet(p.userId, { game: 2000 });

      const start = await request(server)
        .post('/breed/start')
        .set(auth)
        .send({ bizId: biz('breed'), petAId: id1, petBId: id2 });
      expect(start.status).toBe(400); // 宠物未成年

      await request(server).get('/breed/eggs').set(auth).expect(200);
    });
  });

  describe('双向易货 (barter)', () => {
    /** 易货与市场共用同一套闸，开关也共用：总闸 + trade 分档。 */
    const OPEN_TRADE = {
      'market.enabled': true,
      'market.features': {
        recycle: true,
        gift: true,
        listing: true,
        auction: true,
        trade: true,
      },
    };

    /** 建一个已过新号冷却（R1）的玩家 —— 易货现在也查账龄。 */
    async function barterPlayer(game = 0) {
      const p = await e2e.createPlayer();
      await e2e.backdateRegistration(p.userId, 30);
      if (game > 0) await e2e.fundWallet(p.userId, { game });
      return p;
    }

    it('币换物：发起方冻结 → 接受方交割 → 双方持有与余额对齐', async () => {
      await e2e.withConfig(OPEN_TRADE, async () => {
        const a = await barterPlayer(500);
        const b = await barterPlayer();
        const authA = authOf(a.token);
        const authB = authOf(b.token);
        // 食盆商店价 200，对 100 币是 2 倍差，在 valuationBand（3 倍）之内
        await e2e.grantAssets(b.userId, [{ assetCode: 'furn_bowl', count: 1 }]);

        const offer = await request(server)
          .post('/trade/offer')
          .set(authA)
          .send({
            bizId: biz('offer'),
            toUserId: b.userId,
            fromItems: [],
            toItems: [{ assetCode: 'furn_bowl', qty: 1 }],
            fromCoin: 100,
            toCoin: 0,
          })
          .expect(201);
        const offerId = (offer.body as { offer: { id: string } }).offer.id;

        // A 的 100 币应被冻结
        expect((await e2e.walletOf(a.userId)).gameCoin).toBe(400);

        // B 的收件箱能看到
        const inbox = await request(server)
          .get('/trade/inbox')
          .set(authB)
          .expect(200);
        expect((inbox.body as { total: number }).total).toBeGreaterThanOrEqual(
          1,
        );

        await request(server)
          .post('/trade/respond')
          .set(authB)
          .send({ bizId: biz('resp'), offerId, action: 'accept' })
          .expect(201);

        expect((await e2e.walletOf(b.userId)).gameCoin).toBe(100);
        expect(await e2e.ownedQty(a.userId, 'furn_bowl')).toBe(1);
        expect(await e2e.ownedQty(b.userId, 'furn_bowl')).toBe(0);
      });
    });

    /*
     * 以下两条守的是易货的「限价等价物」。易货没有单价，对价是任意物品组合，
     * 所以 market.priceBand 用不上 —— 改判两侧估值不能悬殊。
     * 少了这道闸，「站外真钱付款、站内 1 币交割」就有了专用通道。
     */
    it('单边报价被拒（否则易货成了绕过 gift 分档开关的赠送后门）', async () => {
      await e2e.withConfig(OPEN_TRADE, async () => {
        const a = await barterPlayer(500);
        const b = await barterPlayer();

        await request(server)
          .post('/trade/offer')
          .set(authOf(a.token))
          .send({
            bizId: biz('offer-oneside'),
            toUserId: b.userId,
            fromItems: [],
            toItems: [],
            fromCoin: 100,
            toCoin: 0,
          })
          .expect(400);

        // 被拒后不得留下冻结
        expect((await e2e.walletOf(a.userId)).gameCoin).toBe(500);
      });
    });

    it('两侧估值悬殊被拒（默认上限 3 倍）', async () => {
      await e2e.withConfig(OPEN_TRADE, async () => {
        const a = await barterPlayer(5000);
        const b = await barterPlayer();
        // 食盆 200 换 5000 币 = 25 倍差，远超 3 倍
        await e2e.grantAssets(b.userId, [{ assetCode: 'furn_bowl', count: 1 }]);

        await request(server)
          .post('/trade/offer')
          .set(authOf(a.token))
          .send({
            bizId: biz('offer-skew'),
            toUserId: b.userId,
            fromItems: [],
            toItems: [{ assetCode: 'furn_bowl', qty: 1 }],
            fromCoin: 5000,
            toCoin: 0,
          })
          .expect(400);

        expect((await e2e.walletOf(a.userId)).gameCoin).toBe(5000);
      });
    });

    it('新注册账号不能易货（R1 账龄，双侧都查）', async () => {
      await e2e.withConfig(OPEN_TRADE, async () => {
        const fresh = await e2e.createPlayer(); // 不拨注册时间
        const aged = await barterPlayer();
        await e2e.fundWallet(fresh.userId, { game: 500 });
        await e2e.grantAssets(aged.userId, [
          { assetCode: 'furn_bowl', count: 1 },
        ]);

        await request(server)
          .post('/trade/offer')
          .set(authOf(fresh.token))
          .send({
            bizId: biz('offer-fresh'),
            toUserId: aged.userId,
            fromItems: [],
            toItems: [{ assetCode: 'furn_bowl', qty: 1 }],
            fromCoin: 100,
            toCoin: 0,
          })
          .expect(403);
      });
    });

    it('trade 分档关闭时建单被拒（总闸仍开）', async () => {
      await e2e.withConfig(
        {
          'market.enabled': true,
          'market.features': {
            recycle: true,
            gift: true,
            listing: true,
            auction: true,
            trade: false,
          },
        },
        async () => {
          const a = await barterPlayer(500);
          const b = await barterPlayer();
          await e2e.grantAssets(b.userId, [
            { assetCode: 'furn_bowl', count: 1 },
          ]);

          await request(server)
            .post('/trade/offer')
            .set(authOf(a.token))
            .send({
              bizId: biz('offer-gated'),
              toUserId: b.userId,
              fromItems: [],
              toItems: [{ assetCode: 'furn_bowl', qty: 1 }],
              fromCoin: 100,
              toCoin: 0,
            })
            .expect(403);
        },
      );
    });

    /*
     * 以下三条守的是**标的准入**：易货必须与 market 共用 SubjectResolverService。
     * 只用币做的用例永远碰不到标的校验，所以这三条都必须带物品。
     * 全部走真实 HTTP，而不是直接调 service。
     */
    it('扭蛋产出物不能作为易货标的（堵住开箱变现绕行路）', async () => {
      await e2e.withConfig(OPEN_TRADE, async () => {
        const a = await barterPlayer();
        const b = await barterPlayer();
        await e2e.grantAssets(a.userId, [
          { assetCode: 'cons_snack', count: 1 },
        ]);

        await request(server)
          .post('/trade/offer')
          .set(authOf(a.token))
          .send({
            bizId: biz('offer-gacha'),
            toUserId: b.userId,
            fromItems: [{ assetCode: 'cons_snack', qty: 1 }],
            toItems: [],
            fromCoin: 0,
            toCoin: 0,
          })
          .expect(400);

        // 被拒后不能留下半张单，也不能把标的冻走
        expect(await e2e.ownedQty(a.userId, 'cons_snack')).toBe(1);
      });
    });

    it('获得冷却期内的唯一物品不能易货', async () => {
      await e2e.withConfig(OPEN_TRADE, async () => {
        const a = await barterPlayer();
        const b = await barterPlayer();
        // 不拨 tradable_after：保持铸造时的 now()+72h
        await e2e.grantAssets(a.userId, [{ assetCode: 'acc_cap', count: 1 }]);
        const [inst] = await e2e.instancesOf(a.userId, 'acc_cap');

        await request(server)
          .post('/trade/offer')
          .set(authOf(a.token))
          .send({
            bizId: biz('offer-cooldown'),
            toUserId: b.userId,
            fromItems: [{ instanceId: inst.instanceId }],
            toItems: [],
            fromCoin: 0,
            toCoin: 0,
          })
          .expect(400);
      });
    });

    it('索要对方并未持有的物品时建单即被拒', async () => {
      await e2e.withConfig(OPEN_TRADE, async () => {
        const a = await barterPlayer();
        const b = await barterPlayer();

        await request(server)
          .post('/trade/offer')
          .set(authOf(a.token))
          .send({
            bizId: biz('offer-ghost'),
            toUserId: b.userId,
            fromItems: [],
            toItems: [{ assetCode: 'furn_window', qty: 1 }],
            fromCoin: 0,
            toCoin: 0,
          })
          .expect(400);
      });
    });
  });

  describe('P12 限时活动', () => {
    const eventKey = `e2e_evt_${Date.now()}`;
    afterAll(async () => {
      await e2e.db.query(`DELETE FROM event_progress WHERE event_key = $1`, [
        eventKey,
      ]);
      await e2e.db.query(`DELETE FROM game_event WHERE key = $1`, [eventKey]);
    });

    it('current 显示进行中活动；未完成任务领取报错', async () => {
      const p = await e2e.createPlayer();
      const auth = authOf(p.token);
      await e2e.db.query(
        `INSERT INTO game_event (key, name, type, starts_at, ends_at, payload, enabled)
         VALUES ($1, '春日限定', 'task', now() - interval '1 hour', now() + interval '1 day', $2, true)`,
        [
          eventKey,
          JSON.stringify({
            tasks: [
              {
                taskKey: 'login3',
                name: '登录3天',
                target: 3,
                reward: { assetCode: 'game_coin', count: 200 },
              },
            ],
          }),
        ],
      );

      const cur = await request(server)
        .get('/event/current')
        .set(auth)
        .expect(200);
      const found = (cur.body as { list: { key: string }[] }).list.some(
        (e) => e.key === eventKey,
      );
      expect(found).toBe(true);

      const claim = await request(server)
        .post('/event/claim')
        .set(auth)
        .send({ bizId: biz('claim'), eventKey, taskKey: 'login3' });
      expect(claim.status).toBe(400); // 任务未完成
    });
  });
});
