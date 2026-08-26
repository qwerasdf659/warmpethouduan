/**
 * B4 核实：消耗品与扭蛋的实机链路（打真实 HTTP，连真库，自建自清临时用户）。
 *
 * 单测/e2e 已覆盖分支与接线，这里补的是**跑在 PM2 常驻进程上**的验证 ——
 * 单测的桩不会暴露「锁重入」「配置没播种」「迁移没跑」这类只在真实进程里出现的问题。
 *
 * 验六件事：
 *   A. 概率公示：GET /gacha 的每档百分比合计 100（合规要求前端展示这份数据）；
 *   B. 十连按 costTen 计价，产出 10 档，保底计数推进 10；
 *   C. 同 bizId 重放不重掷不重扣，gacha_draw 只有一行且 delivered=true；
 *   D. 抽到的物品真的进了背包（曾因锁重入静默失败过）；
 *   E. 消耗品买入→使用：持有量减 1、饱食度上升；
 *   F. 兑换中心 game 池虚拟品即时到账（订单直接 shipped + 道具到手）。
 *
 * 用法：node scripts/b4-verify-gacha-consumable.js
 */
const P = '/home/devbox/project/node_modules/';
const jwt = require(P + 'jsonwebtoken');
const Redis = require(P + 'ioredis');
const {
  GAME_COIN,
  db,
  bootApp,
  setAsset,
  balanceOf,
  ownedQty,
  cleanupUser,
} = require('./_verify-fixture');

const BASE = 'http://127.0.0.1:8080';

let failed = 0;
function assert(cond, msg) {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failed++;
}

async function main() {
  // 断言打真实 HTTP（跑在 PM2 常驻进程上），但造数据与清理要走应用上下文：
  // 余额必须经真实记账入口生成，理由见 `_verify-fixture.js`
  const app = await bootApp();
  const c = db();
  await c.connect();
  const redis = new Redis(process.env.REDIS_URL);
  const openid = `b4_gacha_${Date.now()}`;
  const { rows } = await c.query(
    `insert into "user" (openid, status) values ($1,'active') returning id`,
    [openid],
  );
  const userId = rows[0].id;
  const token = jwt.sign({ sub: userId, openid }, process.env.JWT_SECRET, {
    expiresIn: '10m',
  });
  const auth = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const get = (p) => fetch(`${BASE}${p}`, { headers: auth });
  const post = (p, body) =>
    fetch(`${BASE}${p}`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(body),
    });

  try {
    await setAsset(app, userId, GAME_COIN, 60000);
    await post('/pet/create', {
      bizId: `b4-pet-${Date.now()}`,
      species: 'cat',
      nickname: 'B4验证',
    });

    // ---------------------------------------------------------------- A
    const listed = await (await get('/gacha')).json();
    const pool = listed.pools[0];
    assert(!!pool, `GET /gacha 返回奖池（${listed.pools.length} 个）`);
    const sum = pool.odds.reduce((a, o) => a + o.percent, 0);
    assert(
      Math.abs(sum - 100) < 0.01,
      `概率公示合计 100%（实得 ${sum.toFixed(4)}%，${pool.odds.length} 档）`,
    );
    assert(
      pool.pityLeft === pool.pity,
      `新玩家保底剩余 = 保底抽数（${pool.pityLeft}）`,
    );

    // ---------------------------------------------------------------- B
    const bizTen = `b4-ten-${Date.now()}`;
    const tenRes = await post('/gacha/draw', {
      poolKey: pool.key,
      times: 10,
      bizId: bizTen,
    });
    const ten = await tenRes.json();
    assert(tenRes.status === 201, `十连返回 201（实得 ${tenRes.status}）`);
    assert(ten.prizes && ten.prizes.length === 10, '十连产出 10 档');
    assert(
      ten.cost === pool.costTen,
      `十连按 costTen 计价 ${pool.costTen}（实得 ${ten.cost}）`,
    );
    const st = await c.query(
      `select pity, total_draws from gacha_state where user_id = $1`,
      [userId],
    );
    assert(
      Number(st.rows[0].total_draws) === 10,
      `累计抽数推进到 10（实得 ${st.rows[0].total_draws}）`,
    );

    // ---------------------------------------------------------------- C
    const coinAfterTen = await balanceOf(app, userId, GAME_COIN);
    const replay = await (
      await post('/gacha/draw', {
        poolKey: pool.key,
        times: 10,
        bizId: bizTen,
      })
    ).json();
    assert(
      JSON.stringify(replay.prizes.map((p) => p.entryKey)) ===
        JSON.stringify(ten.prizes.map((p) => p.entryKey)),
      '同 bizId 重放返回完全相同的产出（没有重掷）',
    );
    const coinAfterReplay = await balanceOf(app, userId, GAME_COIN);
    assert(coinAfterTen === coinAfterReplay, '重放不二次扣费');
    const draws = await c.query(
      `select count(*) n, bool_and(delivered) d from gacha_draw where user_id = $1 and biz_id = $2`,
      [userId, bizTen],
    );
    assert(
      Number(draws.rows[0].n) === 1,
      `gacha_draw 只落 1 行（实得 ${draws.rows[0].n}）`,
    );
    assert(draws.rows[0].d === true, '产出已标记 delivered');

    // ---------------------------------------------------------------- D
    //
    // D1 之后扭蛋只产出道具与消耗品（不再有币档），所以十连**必然**有产出，
    // 不存在「本次没出物品档、这项跳过」的情形了。
    const wantedCodes = [...new Set(ten.prizes.map((p) => p.itemKey))];
    const missing = [];
    for (const code of wantedCodes) {
      if ((await ownedQty(app, userId, code)) <= 0) missing.push(code);
    }
    assert(
      wantedCodes.length > 0,
      `十连有产出（${wantedCodes.length} 种，D1 之后不再产币）`,
    );
    assert(
      missing.length === 0,
      `抽到的 ${wantedCodes.length} 种产出全部进了背包${
        missing.length ? `（缺 ${missing.join(',')}）` : ''
      }`,
    );

    // ---------------------------------------------------------------- E
    const shop = await (await get('/items/consumables')).json();
    const snack = shop.items.find((i) => i.key === 'cons_snack');
    assert(!!snack, 'GET /items/consumables 返回零食条目');
    assert(
      snack && snack.effect && snack.effect.hunger > 0,
      `零食效果已配置（hunger +${snack && snack.effect && snack.effect.hunger}）`,
    );
    // 断言一律基于基线增量，不能假定持有量从 0 起：上面的十连跟这里测的是同一只
    // `cons_snack`，奖池里出到零食时绝对值就对不上，而出不出是 Math.random 决定的
    // —— 写死绝对值会让这个脚本变成偶发假失败。
    const snackBase = snack ? snack.owned : 0;
    const buyRes = await post('/items/consumables/buy', {
      itemKey: 'cons_snack',
      qty: 2,
      bizId: `b4-buy-${Date.now()}`,
    });
    const buy = await buyRes.json();
    assert(
      buyRes.status === 201 && buy.qty === snackBase + 2,
      `买入 2 份成功（持有 ${buy.qty}，期望 ${snackBase + 2}）`,
    );

    await c.query(
      `update pet set hunger = 40, last_seen_at = now() where user_id = $1`,
      [userId],
    );
    const useRes = await post('/items/consumables/use', {
      itemKey: 'cons_snack',
      bizId: `b4-use-${Date.now()}`,
    });
    const used = await useRes.json();
    assert(useRes.status === 201, `使用返回 201（实得 ${useRes.status}）`);
    assert(
      used.left === snackBase + 1,
      `使用后少 1 份（实得 ${used.left}，期望 ${snackBase + 1}）`,
    );
    assert(
      used.pet && used.pet.hunger > 40,
      `饱食度上升（40 → ${used.pet && used.pet.hunger}）`,
    );

    // ---------------------------------------------------------------- F
    const redeemRes = await post('/exchange/redeem', {
      bizId: `b4-pack-${Date.now()}`,
      exchangeKey: 'snack_pack',
    });
    const redeem = await redeemRes.json();
    assert(
      redeemRes.status === 201 && redeem.order.status === 'shipped',
      `game 池虚拟品即时发货（status=${redeem.order && redeem.order.status}）`,
    );
    assert(
      !!(redeem.order && redeem.order.shippedAt),
      '订单落了 shippedAt 时间',
    );
    const afterPack = await (await get('/items/consumables')).json();
    const snackAfter = afterPack.items.find((i) => i.key === 'cons_snack');
    // 买 2 用 1 净 +1，礼包再发 10 份
    const expectAfterPack = snackBase + 1 + 10;
    assert(
      snackAfter && snackAfter.owned === expectAfterPack,
      `礼包 10 份已到账（持有 ${snackAfter && snackAfter.owned}，期望 ${expectAfterPack}）`,
    );
  } catch (err) {
    failed++;
    console.error('✗ 脚本异常：', err && err.message ? err.message : err);
  } finally {
    await cleanupUser(c, userId);
    const keys = [
      ...(await redis.keys(`*:${userId}:*`)),
      ...(await redis.keys(`*:${userId}`)),
    ];
    if (keys.length) await redis.del(...keys);
    await redis.quit();
    await c.end();
    void app.close();
    console.log(failed === 0 ? '\n全部通过' : `\n失败 ${failed} 项`);
    // 显式退出：ioredis / pg 的句柄偶尔会让进程挂住不退
    process.exit(failed === 0 ? 0 : 1);
  }
}

void main();
