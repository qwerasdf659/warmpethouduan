/**
 * P2-1 核实：兑换下单的并发安全性与幂等性（连真库，自建自清临时用户）。
 *
 * 验三件事：
 *   A. 余额只够兑 1 件时，10 个并发请求（各自不同 bizId）只能成功 1 单，余额不为负；
 *   B. 同一 bizId 重复提交只落 1 单、只扣 1 次（幂等回放）；
 *   C. 目录里没有库存字段 —— 余额足够时可无限量兑同一实物（这是运营风险，不是并发缺陷）。
 *
 * 断言打的是 PM2 常驻进程上的真实 HTTP；造数据与清理走应用上下文，
 * 因为余额必须经真实记账入口生成（理由见 `_verify-fixture.js`）。
 *
 * 用法：npm run build && node scripts/p2-verify-exchange.js
 */
const P = '/home/devbox/project/node_modules/';
const jwt = require(P + 'jsonwebtoken');
const {
  MARKETING_POINT,
  db,
  bootApp,
  setAsset,
  balanceOf,
  entryCount,
  cleanupUser,
  clearIdemKeys,
} = require('./_verify-fixture');

const BASE = 'http://127.0.0.1:8080';
const CONCURRENCY = 10;
const ITEM = 'coupon_5'; // virtual，cost 500 marketing，免收货地址

const ok = (c, m) => console.log(`${c ? '✓' : '✗'} ${m}`);
let failed = 0;
function assert(cond, msg) {
  ok(cond, msg);
  if (!cond) failed++;
}

async function main() {
  console.log('· 启动应用上下文（造数据与清理用）…');
  const app = await bootApp();
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
    // 只给刚好 1 件的积分（营销积分只能后台发放，这里等价于后台发放）
    await setAsset(app, userId, MARKETING_POINT, cost);

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

    const balance = await balanceOf(app, userId, MARKETING_POINT);
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
    await setAsset(app, userId, MARKETING_POINT, cost);
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
    const balanceAfterIdem = await balanceOf(app, userId, MARKETING_POINT);
    const o2 = await c.query(
      `select count(*)::int n from redeem_order where user_id=$1 and biz_id=$2`,
      [userId, sameBiz],
    );
    console.log(`\n[B] 同 bizId 两次：${first.status} / ${second.status}`);
    assert(o2.rows[0].n === 1, `同 bizId 只落 1 单（实际 ${o2.rows[0].n}）`);
    assert(
      balanceAfterIdem === 0,
      `只扣 1 次（余额 ${balanceAfterIdem}，期望 0）`,
    );
    assert(
      fj?.order?.id && sj?.order?.id && fj.order.id === sj.order.id,
      '第二次返回同一张订单（幂等回放）',
    );

    // ---- C. 不限量项（stock=null、perUserLimit=null）：积分足够就该一直兑得动
    const many = 5;
    await setAsset(app, userId, MARKETING_POINT, cost * many);
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

    // ---- 每笔兑换都留了分录
    //
    // 只数扣费分录（reason='exchange'）：造数据用的发放/扣减也会留分录，
    // 混在一起数就得不到「成功兑换了几笔」这个量。
    const spends = await c.query(
      `select count(*)::int n
         from asset_entry e
         join asset_txn t on t.id = e.txn_id
         join account a on a.id = e.account_id
        where a.user_id = $1 and t.reason = 'exchange'`,
      [userId],
    );
    const expected = 1 + 1 + many;
    assert(
      spends.rows[0].n === expected,
      `每笔成功兑换都留了分录（实际 ${spends.rows[0].n} 条，期望 ${expected}）`,
    );
    console.log(
      `\n[对账] 该玩家分录合计 ${await entryCount(c, userId)} 条` +
        `（含造数据用的发放/扣减；余额、批次、分录三层由记账入口保证一致）`,
    );
  } finally {
    await cleanupUser(c, userId);
    const keys = await clearIdemKeys(userId);
    console.log(`\n已清理临时用户 ${userId}（含 ${keys} 个幂等键）`);
    await c.end();
    await app.close();
  }
  console.log(failed ? `\n有 ${failed} 项不符合预期` : '\n全部符合预期');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('执行失败：', e);
  process.exit(1);
});
