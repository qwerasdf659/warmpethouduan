/**
 * P2-1 核实：兑换下单的并发安全性与幂等性（连真库，自建自清临时用户）。
 *
 * 验三件事：
 *   A. 余额只够兑 1 件时，10 个并发请求（各自不同 bizId）只能成功 1 单，余额不为负；
 *   B. 同一 bizId 重复提交只落 1 单、只扣 1 次（幂等回放）；
 *   C. 目录里没有库存字段 —— 余额足够时可无限量兑同一实物（这是运营风险，不是并发缺陷）。
 *
 * 用法：node scripts/p2-verify-exchange.js
 */
const P = '/home/devbox/project/node_modules/';
require(P + 'dotenv').config({ path: '/home/devbox/project/.env' });
const { Client } = require(P + 'pg');
const jwt = require(P + 'jsonwebtoken');
const Redis = require(P + 'ioredis');

const BASE = 'http://127.0.0.1:8080';
const CONCURRENCY = 10;
const ITEM = 'coupon_5'; // virtual，cost 500 marketing，免收货地址

function db() {
  return new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
}

const ok = (c, m) => console.log(`${c ? '✓' : '✗'} ${m}`);
let failed = 0;
function assert(cond, msg) {
  ok(cond, msg);
  if (!cond) failed++;
}

async function main() {
  const c = db();
  await c.connect();
  const openid = `p2_exchange_${Date.now()}`;
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

  try {
    const cost = 500;
    // 只给刚好 1 件的积分（营销积分只能后台发放，这里直接建钱包等价于后台发放）
    await c.query(
      `insert into wallet (user_id, game_coin, marketing_point)
       values ($1, 0, $2)
       on conflict (user_id) do update set marketing_point = $2`,
      [userId, cost],
    );

    // ---- A. 并发下单（不同 bizId）
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        fetch(`${BASE}/exchange/redeem`, {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({
            exchangeKey: ITEM,
            bizId: `p2-conc-${i}-${Date.now()}`,
          }),
        }).then(async (r) => ({ status: r.status, body: await r.json() })),
      ),
    );
    const created = results.filter((r) => r.status === 201 || r.status === 200);
    const statuses = results.reduce((a, r) => {
      a[r.status] = (a[r.status] || 0) + 1;
      return a;
    }, {});
    console.log(`\n[A] 并发 ${CONCURRENCY} 单，状态分布：`, statuses);

    const w1 = await c.query(
      `select marketing_point from wallet where user_id=$1`,
      [userId],
    );
    const balance = Number(w1.rows[0].marketing_point);
    const o1 = await c.query(
      `select count(*)::int n from redeem_order where user_id=$1`,
      [userId],
    );

    assert(created.length === 1, `只成功 1 单（实际 ${created.length}）`);
    assert(balance === 0, `余额扣净且不为负（实际 ${balance}）`);
    assert(o1.rows[0].n === 1, `只落 1 条订单（实际 ${o1.rows[0].n}）`);
    const rejected = results.find((r) => r.status >= 400);
    if (rejected) console.log('    被拒示例：', rejected.status, rejected.body);

    // ---- B. 同 bizId 重复提交
    await c.query(`update wallet set marketing_point=$2 where user_id=$1`, [
      userId,
      cost,
    ]);
    const sameBiz = `p2-idem-${Date.now()}`;
    const first = await fetch(`${BASE}/exchange/redeem`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ exchangeKey: ITEM, bizId: sameBiz }),
    });
    const fj = await first.json();
    const second = await fetch(`${BASE}/exchange/redeem`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ exchangeKey: ITEM, bizId: sameBiz }),
    });
    const sj = await second.json();
    const w2 = await c.query(
      `select marketing_point from wallet where user_id=$1`,
      [userId],
    );
    const o2 = await c.query(
      `select count(*)::int n from redeem_order where user_id=$1 and biz_id=$2`,
      [userId, sameBiz],
    );
    console.log(`\n[B] 同 bizId 两次：${first.status} / ${second.status}`);
    assert(o2.rows[0].n === 1, `同 bizId 只落 1 单（实际 ${o2.rows[0].n}）`);
    assert(
      Number(w2.rows[0].marketing_point) === 0,
      `只扣 1 次（余额 ${w2.rows[0].marketing_point}，期望 0）`,
    );
    assert(
      fj?.order?.id && sj?.order?.id && fj.order.id === sj.order.id,
      '第二次返回同一张订单（幂等回放）',
    );

    // ---- C. 不限量项（stock=null、perUserLimit=null）：积分足够就该一直兑得动
    const many = 5;
    await c.query(`update wallet set marketing_point=$2 where user_id=$1`, [
      userId,
      cost * many,
    ]);
    for (let i = 0; i < many; i++) {
      await fetch(`${BASE}/exchange/redeem`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          exchangeKey: ITEM,
          bizId: `p2-nostock-${i}-${Date.now()}`,
        }),
      });
    }
    const o3 = await c.query(
      `select count(*)::int n from redeem_order where user_id=$1 and exchange_key=$2`,
      [userId, ITEM],
    );
    console.log(
      `\n[C] 不限量项累计订单数 = ${o3.rows[0].n}（该项配置为不限量，不该被拦）` +
        `\n    限量项的库存与限购见 scripts/p2-verify-stock.js`,
    );

    // ---- 流水与余额一致性
    const recon = await c.query(
      `select coalesce(sum(delta),0)::bigint s from ledger where user_id=$1 and pool='marketing'`,
      [userId],
    );
    console.log(
      `\n[对账] ledger 求和 = ${recon.rows[0].s}（注：本脚本用 SQL 直接改过余额，故此值不等于钱包余额，仅用于确认每单都留了流水）`,
    );
    const ledgerCount = await c.query(
      `select count(*)::int n from ledger where user_id=$1`,
      [userId],
    );
    assert(
      ledgerCount.rows[0].n === 1 + 1 + many,
      `每笔成功兑换都留了流水（实际 ${ledgerCount.rows[0].n} 条，期望 ${1 + 1 + many}）`,
    );
  } finally {
    await c.query(`delete from redeem_order where user_id=$1`, [userId]);
    await c.query(`delete from ledger where user_id=$1`, [userId]);
    await c.query(`delete from wallet where user_id=$1`, [userId]);
    await c.query(`delete from "user" where id=$1`, [userId]);
    // 幂等键有 24h TTL，但共用开发环境，顺手清掉免得干扰排查
    const redis = new Redis(process.env.REDIS_URL);
    const keys = await redis.keys(`idem:${userId}:*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
    console.log(`\n已清理临时用户 ${userId}（含 ${keys.length} 个幂等键）`);
    await c.end();
  }
  console.log(failed ? `\n有 ${failed} 项不符合预期` : '\n全部符合预期');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('执行失败：', e);
  process.exit(1);
});
