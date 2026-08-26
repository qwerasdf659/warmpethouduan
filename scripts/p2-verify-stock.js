/**
 * B1 验收：兑换库存与每人限购（连真库，自建自清临时用户）。
 *
 * [A] 每人限购：limit=1 的实物，第二次下单被拒且不扣费
 * [B] 幂等回放优先于限购：同一 bizId 重试返回原订单，不被当成第二次兑换
 * [C] 取消订单回库：取消后同一玩家可以再兑
 * [D] 全站库存并发：stock=1 时 8 个玩家同抢，只能成一单，落败者积分原样退回
 *
 * 用法：node scripts/p2-verify-stock.js   （需先 npm run build）
 */
const P = '/home/devbox/project/node_modules/';
require(P + 'dotenv').config({ path: '/home/devbox/project/.env' });
const { Client } = require(P + 'pg');
const Redis = require(P + 'ioredis');

const dist = '/home/devbox/project/dist/';
const { NestFactory } = require(P + '@nestjs/core');
const { AppModule } = require(dist + 'app.module');
const { ExchangeService } = require(dist + 'exchange/exchange.service');
const { AdminExchangeService } = require(dist + 'admin/ops/admin-exchange.service');
const { GameConfigService } = require(dist + 'config/game-config.service');

const KEY = 'plush_toy';

function db() {
  return new Client({
    host: process.env.DB_HOST,
    port: +process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
}

async function main() {
  const pg = db();
  await pg.connect();
  const redis = new Redis(process.env.REDIS_URL);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const exchange = app.get(ExchangeService);
  const adminExchange = app.get(AdminExchangeService);
  const config = app.get(GameConfigService);

  const users = [];
  const origItems = (
    await pg.query(`SELECT value FROM game_config WHERE key = 'exchange.items'`)
  ).rows[0].value;

  async function setCatalog(patch) {
    const next = origItems.map((i) =>
      i.key === KEY ? { ...i, ...patch } : i,
    );
    await pg.query(
      `UPDATE game_config SET value = $1 WHERE key = 'exchange.items'`,
      [JSON.stringify(next)],
    );
    config.invalidate();
  }

  async function newPlayer(points) {
    const openid = `stock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const id = (
      await pg.query(
        `INSERT INTO "user" (openid, status) VALUES ($1, 'active') RETURNING id`,
        [openid],
      )
    ).rows[0].id;
    users.push(id);
    await pg.query(
      `INSERT INTO wallet (user_id, game_coin, marketing_point) VALUES ($1, 0, $2)`,
      [id, points],
    );
    const addr = (
      await pg.query(
        `INSERT INTO user_address (user_id, receiver, phone, region, detail, is_default)
         VALUES ($1, '测试', '13800000000', '广东省/深圳市', '测试地址', true) RETURNING id`,
        [id],
      )
    ).rows[0].id;
    return { id, addr };
  }

  const points = (userId) =>
    pg
      .query(`SELECT marketing_point FROM wallet WHERE user_id = $1`, [userId])
      .then((r) => Number(r.rows[0].marketing_point));

  try {
    // ---------------------------------------------------------------- [A][B][C]
    await setCatalog({ stock: 100, perUserLimit: 1 });
    const u = await newPlayer(10000);

    const first = await exchange.redeem(u.id, KEY, 'biz-1', u.addr);
    console.log(`[A] 首单 status=${first.order.status} 余额=${await points(u.id)}`);

    let denied = null;
    try {
      await exchange.redeem(u.id, KEY, 'biz-2', u.addr);
    } catch (e) {
      denied = e.message;
    }
    const afterDeny = await points(u.id);
    console.log(
      denied
        ? `✓ 第二单被拒：${denied}（余额未变 = ${afterDeny}）`
        : `✗ 限购失效：第二单成功了`,
    );

    const replay = await exchange.redeem(u.id, KEY, 'biz-1', u.addr);
    console.log(
      replay.order.id === first.order.id
        ? `✓ [B] 同 bizId 重试回放原订单 #${replay.order.id}，没被限购误判`
        : `✗ [B] 重试建了新单 #${replay.order.id}`,
    );

    await adminExchange.cancel(String(first.order.id), { reason: 'B1 验收' });
    const afterCancel = await points(u.id);
    const retry = await exchange.redeem(u.id, KEY, 'biz-3', u.addr);
    console.log(
      `✓ [C] 取消退款后余额=${afterCancel}，且库存/限购回滚 → 可再兑 #${retry.order.id}`,
    );

    // -------------------------------------------------------------------- [D]
    await setCatalog({ stock: null, perUserLimit: null });
    await pg.query(`DELETE FROM redeem_order WHERE exchange_key = $1 AND user_id = ANY($2)`, [
      KEY,
      users,
    ]);
    const sold = Number(
      (
        await pg.query(
          `SELECT count(*) c FROM redeem_order WHERE exchange_key = $1 AND status <> 'cancelled'`,
          [KEY],
        )
      ).rows[0].c,
    );
    // 把库存设成「现存量 + 1」，只留一件给下面 8 个人抢
    await setCatalog({ stock: sold + 1, perUserLimit: null });

    const rushers = [];
    for (let i = 0; i < 8; i++) rushers.push(await newPlayer(10000));
    const results = await Promise.allSettled(
      rushers.map((r, i) => exchange.redeem(r.id, KEY, `rush-${i}`, r.addr)),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const balances = await Promise.all(rushers.map((r) => points(r.id)));
    const refundedAll = results.every(
      (r, i) => (r.status === 'fulfilled' ? balances[i] === 8000 : balances[i] === 10000),
    );
    console.log(
      `[D] 8 人抢 1 件：成功 ${ok} 单、失败 ${8 - ok} 单`,
    );
    console.log(
      ok === 1 ? '✓ 没有超卖' : `✗ 超卖了 ${ok} 件`,
      refundedAll ? '｜✓ 落败者积分分文未动' : '｜✗ 有人被扣了钱却没拿到货',
    );
    const reason = results.find((r) => r.status === 'rejected')?.reason?.message;
    if (reason) console.log(`    落败者收到：${reason}`);
  } finally {
    await pg.query(
      `UPDATE game_config SET value = $1 WHERE key = 'exchange.items'`,
      [JSON.stringify(origItems)],
    );
    for (const id of users) {
      for (const t of ['redeem_order', 'user_address', 'ledger', 'wallet']) {
        await pg.query(`DELETE FROM ${t} WHERE user_id = $1`, [id]);
      }
      await pg.query(`DELETE FROM "user" WHERE id = $1`, [id]);
      const keys = await redis.keys(`*${id}*`);
      if (keys.length) await redis.del(...keys);
    }
    console.log(`\n已清理临时用户 ${users.join(', ')}，配置已还原`);
    await pg.end();
    await redis.quit();
    process.exit(0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
