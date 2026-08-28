import { Server } from 'node:http';
import request from 'supertest';
import { ConditionService } from '../src/condition/condition.service';
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

    /**
     * 自愈全链路。`pet.cure` 一直配着 `selfHealStat`/`selfHealHours`、
     * 接口也一直宣称 `curableBy` 含 `'self'`，但此前零实现——
     * 「承诺了没做」比没有这个功能更糟，因为玩家会照着提示等一个不会来的痊愈。
     *
     * 直接调 `scan()` 而不等 cron：cron 每小时一次，e2e 不可能等。
     */
    it('属性回升并维持后自动痊愈（cured_by=self）', async () => {
      const p = await playerWithPet();
      const condition = e2e.app.get(ConditionService);
      const petRow = await e2e.db.query<{ id: string }[]>(
        `SELECT id FROM pet WHERE user_id = $1 AND is_active = true`,
        [p.userId],
      );
      const petId = petRow[0].id;

      // 1) 把宠物饿到长期归零 → 巡检应判定营养不良
      await e2e.db.query(
        `UPDATE pet SET hunger = 0, mood = 0, cleanliness = 0,
                        last_seen_at = now() - interval '48 hours'
          WHERE id = $1`,
        [petId],
      );
      await condition.scan();
      const sick = await request(server)
        .get('/pet/conditions')
        .set(p.auth)
        .expect(200);
      const list = (sick.body as { conditions: { key: string }[] }).conditions;
      expect(list.length).toBeGreaterThan(0);

      // 2) 喂饱（属性达标）但维持时间还不够 → 只起计时，不痊愈
      await e2e.db.query(
        `UPDATE pet SET hunger = 100, mood = 100, cleanliness = 100,
                        last_seen_at = now()
          WHERE id = $1`,
        [petId],
      );
      await condition.scan();
      const stillSick = await e2e.db.query<{ n: string }[]>(
        `SELECT count(*) n FROM pet_condition
          WHERE pet_id = $1 AND cured_at IS NULL AND healthy_since IS NOT NULL`,
        [petId],
      );
      expect(Number(stillSick[0].n)).toBeGreaterThan(0);

      // 3) 把维持锚点拨到足够久之前 → 本轮巡检应痊愈
      await e2e.db.query(
        `UPDATE pet_condition SET healthy_since = now() - interval '24 hours'
          WHERE pet_id = $1 AND cured_at IS NULL`,
        [petId],
      );
      await condition.scan();

      const healed = await e2e.db.query<{ cured_by: string }[]>(
        `SELECT cured_by FROM pet_condition
          WHERE pet_id = $1 AND cured_at IS NOT NULL`,
        [petId],
      );
      expect(healed.length).toBeGreaterThan(0);
      expect(healed.every((r) => r.cured_by === 'self')).toBe(true);

      const after = await request(server)
        .get('/pet/conditions')
        .set(p.auth)
        .expect(200);
      expect((after.body as { conditions: unknown[] }).conditions).toEqual([]);
    });

    it('属性掉回阈值以下时维持计时清零（不能靠喂一口就等自愈）', async () => {
      const p = await playerWithPet();
      const condition = e2e.app.get(ConditionService);
      const petRow = await e2e.db.query<{ id: string }[]>(
        `SELECT id FROM pet WHERE user_id = $1 AND is_active = true`,
        [p.userId],
      );
      const petId = petRow[0].id;

      await e2e.db.query(
        `UPDATE pet SET hunger = 0, mood = 0, cleanliness = 0,
                        last_seen_at = now() - interval '48 hours'
          WHERE id = $1`,
        [petId],
      );
      await condition.scan();

      // 喂饱起计时
      await e2e.db.query(
        `UPDATE pet SET hunger = 100, mood = 100, cleanliness = 100,
                        last_seen_at = now() WHERE id = $1`,
        [petId],
      );
      await condition.scan();

      // 再放着饿回去 → 计时必须清零
      await e2e.db.query(
        `UPDATE pet SET hunger = 0, mood = 0, cleanliness = 0,
                        last_seen_at = now() - interval '48 hours'
          WHERE id = $1`,
        [petId],
      );
      await condition.scan();

      const rows = await e2e.db.query<{ healthy_since: Date | null }[]>(
        `SELECT healthy_since FROM pet_condition
          WHERE pet_id = $1 AND cured_at IS NULL`,
        [petId],
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.healthy_since === null)).toBe(true);
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

  describe('P11 小游戏（记忆翻牌）', () => {
    interface FlipBody {
      index: number;
      face: number;
      firstIndex: number | null;
      firstFace: number | null;
      matched: boolean | null;
      matchedIndices: number[];
      attempts: number;
      finished: boolean;
    }

    async function startGame(auth: Record<string, string>) {
      const start = await request(server)
        .post('/minigame/start')
        .set(auth)
        .send({ bizId: biz('mg-start'), gameKey: 'memory' })
        .expect(201);
      return start.body as {
        session: { id: string; boardSize: number; matched: number[] };
      };
    }

    const flip = async (
      auth: Record<string, string>,
      sessionId: string,
      index: number,
    ) => {
      const res = await request(server)
        .post('/minigame/flip')
        .set(auth)
        .send({ sessionId, index })
        .expect(201);
      return res.body as FlipBody;
    };

    it('目录只有记忆翻牌，且下发牌位数', async () => {
      const p = await playerWithPet();
      const list = await request(server)
        .get('/minigame/list')
        .set(p.auth)
        .expect(200);
      const body = list.body as {
        total: number;
        list: { key: string; boardSize: number }[];
      };
      expect(body.total).toBe(1);
      expect(body.list[0].key).toBe('memory');
      expect(body.list[0].boardSize).toBe(16);
    });

    /**
     * 服务端权威的核心断言：`start` **不下发 seed**。
     * seed 能推出整副牌，下发等于把答案交给客户端 —— 那样「记忆」就不存在了，
     * 任何客户端都能直接翻出满分。
     */
    it('start 不下发 seed，只给牌位数', async () => {
      const p = await playerWithPet();
      const { session } = await startGame(p.auth);
      expect(session.boardSize).toBe(16);
      expect(session).not.toHaveProperty('seed');
      expect(session.matched).toEqual([]);
    });

    it('翻牌由服务端揭示花色；同一副牌两次读取一致', async () => {
      const p = await playerWithPet();
      const { session } = await startGame(p.auth);

      const first = await flip(p.auth, session.id, 0);
      expect(first.firstIndex).toBeNull();
      expect(first.matched).toBeNull();
      expect(first.face).toBeGreaterThanOrEqual(0);

      const second = await flip(p.auth, session.id, 1);
      expect(second.firstIndex).toBe(0);
      expect(second.firstFace).toBe(first.face);
      expect(second.attempts).toBe(1);
      expect(typeof second.matched).toBe('boolean');
    });

    it('已配对的牌不能再翻，同一张牌不能连翻两次', async () => {
      const p = await playerWithPet();
      const { session } = await startGame(p.auth);

      await flip(p.auth, session.id, 0);
      // 同一张连翻
      await request(server)
        .post('/minigame/flip')
        .set(p.auth)
        .send({ sessionId: session.id, index: 0 })
        .expect(400);

      // 越界
      await request(server)
        .post('/minigame/flip')
        .set(p.auth)
        .send({ sessionId: session.id, index: 16 })
        .expect(400);
    });

    /**
     * 全部配对完成 → 满分结算。
     *
     * 用「逐位试探」把整副牌翻完：这也顺带证明分数确实随过程变化，
     * 而不是一个与操作无关的占位值 —— 试探的失败次数会把分数压下来。
     */
    it('打完一局并结算：分数由服务端进度派生，发币入账', async () => {
      const p = await playerWithPet();
      const { session } = await startGame(p.auth);
      const size = session.boardSize;

      // 先摸清整副牌：每次翻两张（服务端会告知花色），记录下来
      const faces = new Map<number, number>();
      let matchedAll: number[] = [];
      for (let i = 0; i < size; i += 2) {
        const a = await flip(p.auth, session.id, i);
        faces.set(i, a.face);
        const b = await flip(p.auth, session.id, i + 1);
        faces.set(i + 1, b.face);
        matchedAll = b.matchedIndices;
      }

      // 把剩下的按花色配对翻完
      const remaining = [...faces.keys()].filter(
        (i) => !matchedAll.includes(i),
      );
      const byFace = new Map<number, number[]>();
      for (const i of remaining) {
        const f = faces.get(i)!;
        byFace.set(f, [...(byFace.get(f) ?? []), i]);
      }
      let finished = false;
      for (const [, idx] of byFace) {
        if (idx.length !== 2) continue;
        await flip(p.auth, session.id, idx[0]);
        const res = await flip(p.auth, session.id, idx[1]);
        finished = res.finished;
      }
      expect(finished).toBe(true);

      const before = (await e2e.walletOf(p.userId)).gameCoin;
      const settle = await request(server)
        .post('/minigame/settle')
        .set(p.auth)
        .send({ bizId: biz('mg-settle'), sessionId: session.id })
        .expect(201);
      const body = settle.body as {
        score: number;
        rewardCoin: number;
        matchedPairs: number;
        attempts: number;
        wallet: { gameCoin: number };
      };

      expect(body.matchedPairs).toBe(size / 2);
      // 8 对 × 100 分 − 失误 × 20，且封顶 maxRewardCoin=60
      expect(body.score).toBeGreaterThan(0);
      expect(body.rewardCoin).toBeGreaterThan(0);
      expect(body.rewardCoin).toBeLessThanOrEqual(60);
      expect(body.wallet.gameCoin).toBe(before + body.rewardCoin);

      // 结算后不可再翻、不可再结算
      await request(server)
        .post('/minigame/flip')
        .set(p.auth)
        .send({ sessionId: session.id, index: 0 })
        .expect(400);
      await request(server)
        .post('/minigame/settle')
        .set(p.auth)
        .send({ bizId: biz('mg-settle2'), sessionId: session.id })
        .expect(400);
    });

    it('一局未翻任何牌就结算：0 分 0 币，不报错', async () => {
      const p = await playerWithPet();
      const { session } = await startGame(p.auth);
      const settle = await request(server)
        .post('/minigame/settle')
        .set(p.auth)
        .send({ bizId: biz('mg-empty'), sessionId: session.id })
        .expect(201);
      const body = settle.body as { score: number; rewardCoin: number };
      expect(body.score).toBe(0);
      expect(body.rewardCoin).toBe(0);
    });

    it('别人的对局翻不了（对局按 userId 归属）', async () => {
      const a = await playerWithPet();
      const b = await playerWithPet();
      const { session } = await startGame(a.auth);

      await request(server)
        .post('/minigame/flip')
        .set(b.auth)
        .send({ sessionId: session.id, index: 0 })
        .expect(400);
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

  /**
   * 满减券的全链路。
   *
   * 券做成 `redeemable=true` 的可堆叠资产，因此有效期、过期销毁、不可流转
   * 全部由账本现成机制承担——这几条用例守的正是那些「免费得到」的性质，
   * 尤其是**数据库层面强制不可交易**：券一旦能转手，「积分→券→卖币」这条
   * 变现链就通了。
   */
  describe('满减券', () => {
    it('券是 redeemable 资产，且数据库强制其不可交易', async () => {
      const rows = await e2e.db.query<
        {
          kind: string;
          tradable: boolean;
          redeemable: boolean;
          expire_days: number | null;
        }[]
      >(
        `SELECT kind, tradable, redeemable, expire_days
           FROM asset_def WHERE code = 'coupon_off5'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].kind).toBe('stackable');
      expect(rows[0].redeemable).toBe(true);
      // ck_asset_no_trade_redeem：可兑实物 ⇒ 不可交易
      expect(rows[0].tradable).toBe(false);
      // 有效期非空才能给待兑付负债封顶
      expect(rows[0].expire_days).toBe(90);
    });

    it('兑换即时到账进背包，coupons 能查到满减规则', async () => {
      const p = await e2e.createPlayer();
      await e2e.fundWallet(p.userId, { marketing: 1000 });

      const redeem = await request(server)
        .post('/exchange/redeem')
        .set(authOf(p.token))
        .send({ bizId: biz('cp-redeem'), exchangeKey: 'coupon_off5' })
        .expect(201);
      // 自动发货 ⇒ 订单直接 shipped，不再是等运营处理的 pending
      expect((redeem.body as { order: { status: string } }).order.status).toBe(
        'shipped',
      );
      expect(await e2e.ownedQty(p.userId, 'coupon_off5')).toBe(1);

      const list = await request(server)
        .get('/exchange/coupons')
        .set(authOf(p.token))
        .expect(200);
      const coupons = (
        list.body as {
          coupons: {
            assetCode: string;
            qty: number;
            threshold: number;
            deduct: number;
          }[];
        }
      ).coupons;
      expect(coupons).toHaveLength(1);
      expect(coupons[0]).toMatchObject({
        assetCode: 'coupon_off5',
        qty: 1,
        threshold: 5000,
        deduct: 500,
      });
    });

    /** 后台令牌必须真登一次拿到（`createAdmin` 刻意不返回令牌）。 */
    async function adminAuth(permissions: string[]) {
      const admin = await e2e.createAdmin({ permissions });
      const res = await request(server)
        .post('/admin/auth/login')
        .send({ username: admin.username, password: admin.password })
        .expect(201);
      const { token } = res.body as { token: string };
      return { Authorization: `Bearer ${token}` };
    }

    it('出示核销码即销毁券；同一码只能核销一次', async () => {
      const p = await e2e.createPlayer();
      const adminHeaders = await adminAuth(['exchange:write']);
      await e2e.fundWallet(p.userId, { marketing: 1000 });
      await request(server)
        .post('/exchange/redeem')
        .set(authOf(p.token))
        .send({ bizId: biz('cp-r2'), exchangeKey: 'coupon_off5' })
        .expect(201);

      const issued = await request(server)
        .post('/exchange/coupons/code')
        .set(authOf(p.token))
        .send({ bizId: biz('cp-code'), assetCode: 'coupon_off5' })
        .expect(201);
      const code = (issued.body as { code: string }).code;
      expect(code).toHaveLength(8);
      // 券在出示的那一刻就离手了
      expect(await e2e.ownedQty(p.userId, 'coupon_off5')).toBe(0);

      const verify = await request(server)
        .post('/admin/exchange/coupons/verify')
        .set(adminHeaders)
        .send({ code })
        .expect(201);
      expect(verify.body as { ok: boolean; deduct: number }).toMatchObject({
        ok: true,
        deduct: 500,
      });

      // 二次核销必须失败，否则一张券能在两家店用
      await request(server)
        .post('/admin/exchange/coupons/verify')
        .set(adminHeaders)
        .send({ code })
        .expect(400);
    });

    it('没有券时出示核销码被拒', async () => {
      const p = await e2e.createPlayer();
      await request(server)
        .post('/exchange/coupons/code')
        .set(authOf(p.token))
        .send({ bizId: biz('cp-none'), assetCode: 'coupon_off5' })
        .expect(400);
    });

    it('券不能被赠送（可兑实物资产禁止玩家间流转）', async () => {
      await e2e.withConfig(
        {
          'market.enabled': true,
          'market.features': {
            recycle: true,
            gift: true,
            listing: true,
            auction: true,
            trade: true,
          },
        },
        async () => {
          const a = await e2e.createPlayer();
          const b = await e2e.createPlayer();
          await e2e.backdateRegistration(a.userId, 30);
          await e2e.backdateRegistration(b.userId, 30);
          await e2e.fundWallet(a.userId, { marketing: 1000 });
          await request(server)
            .post('/exchange/redeem')
            .set(authOf(a.token))
            .send({ bizId: biz('cp-r3'), exchangeKey: 'coupon_off5' })
            .expect(201);

          await request(server)
            .post('/market/gift')
            .set(authOf(a.token))
            .send({
              bizId: biz('cp-gift'),
              toUserId: b.userId,
              assetCode: 'coupon_off5',
              qty: 1,
            })
            .expect(400);
        },
      );
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
