/**
 * P2-1 续：后台履约（发货 / 取消退款）的并发安全性。
 * 直接在应用上下文里并发调用 Service，绕开后台登录（不改任何凭证配置）。
 *
 * 验两件事：
 *   A. 同一订单并发「取消退款」两次 —— 会不会退两次钱；
 *   B. 同一订单并发「发货」与「取消退款」—— 会不会既发货又退款（资损）。
 *
 * 用法：npm run build && node scripts/p2-verify-fulfillment.js
 */
const {
  MARKETING_POINT,
  db,
  bootApp,
  setAsset,
  balanceOf,
  cleanupUser,
} = require('./_verify-fixture');

async function makeOrder(c, userId, cost) {
  const r = await c.query(
    `insert into redeem_order
       (user_id, exchange_key, item_name, item_type, cost, pool, status, biz_id)
     values ($1,'coupon_5','5 元代金券','virtual',$2,'marketing','pending',$3)
     returning id`,
    [userId, cost, `p2-fulfill-${Date.now()}-${Math.random()}`],
  );
  return r.rows[0].id;
}

async function main() {
  console.log('· 启动应用上下文 …');
  const app = await bootApp();
  console.log('· 上下文就绪');
  const {
    AdminExchangeService,
  } = require('/home/devbox/project/dist/admin/ops/admin-exchange.service');
  const svc = app.get(AdminExchangeService);

  const c = db();
  await c.connect();
  const openid = `p2_fulfill_${Date.now()}`;
  const u = await c.query(
    `insert into "user" (openid, status) values ($1,'active') returning id`,
    [openid],
  );
  const userId = u.rows[0].id;
  const cost = 500;
  // 从 0 起：下面两个用例都是「订单已建、看退款退几次」，初始余额必须干净
  await setAsset(app, userId, MARKETING_POINT, 0);

  const balance = () => balanceOf(app, userId, MARKETING_POINT);

  try {
    // ---- A. 并发双取消
    const idA = await makeOrder(c, userId, cost);
    const ra = await Promise.allSettled([
      svc.cancel(idA, { reason: 'p2-a1' }),
      svc.cancel(idA, { reason: 'p2-a2' }),
    ]);
    const balA = await balance();
    console.log(
      `[A] 并发双取消：结果 ${ra.map((x) => x.status).join(' / ')}；退款后余额 = ${balA}（单件成本 ${cost}）`,
    );
    console.log(
      balA === cost
        ? '✓ 只退了一次 —— 靠 asset_txn.biz_id 全局唯一键拦住第二次，不是靠状态判断'
        : `✗ 退款金额异常：${balA}`,
    );

    // ---- B. 并发「发货」与「取消退款」
    await setAsset(app, userId, MARKETING_POINT, 0);
    const idB = await makeOrder(c, userId, cost);
    const rb = await Promise.allSettled([
      svc.ship(idB, { trackingNo: 'SF-P2-TEST' }),
      svc.cancel(idB, { reason: 'p2-b' }),
    ]);
    const row = (
      await c.query(
        `select status, tracking_no, remark from redeem_order where id=$1`,
        [idB],
      )
    ).rows[0];
    const balB = await balance();
    console.log(
      `\n[B] 并发发货+取消：结果 ${rb.map((x) => x.status).join(' / ')}`,
    );
    console.log(
      `    订单终态 status=${row.status} tracking_no=${row.tracking_no} 退款金额=${balB}`,
    );
    // 判据：两个操作是否都「自认成功」。终态字段谁赢是看哪次 save() 落在后面，
    // 不能用终态来判互斥 —— 后写的整实体 save 会把前一次的字段覆盖掉（丢失更新）。
    const bothFulfilled = rb.every((x) => x.status === 'fulfilled');
    console.log(
      bothFulfilled
        ? '✗ 发货与取消都返回成功：状态校验是「先读后写」，互不阻塞。' +
            `\n    实际后果：点发货的运营拿到 200(status=shipped) 会去仓库发货，` +
            `而取消方退了 ${balB} 积分且把状态改回 ${row.status}、物流单号被覆盖为 ${row.tracking_no}。` +
            '\n    → 实物发出 + 积分退回 = 资损，且库里查不到发货痕迹。'
        : '✓ 两者互斥，只有一个生效',
    );
    rb.forEach((x, i) => {
      const name = i === 0 ? 'ship' : 'cancel';
      if (x.status === 'rejected')
        console.log(`    ${name} 被拒：${x.reason?.message ?? x.reason}`);
      else console.log(`    ${name} 返回 status=${x.value?.order?.status}`);
    });
  } finally {
    await cleanupUser(c, userId);
    console.log(`\n已清理临时用户 ${userId}`);
    await c.end();
    // app.close() 在本项目的上下文里不会返回（Redis 连接与定时器仍持有句柄），
    // 清理已完成，直接退进程，避免脚本挂住。
    void app.close();
    process.exit(0);
  }
}

main().catch((e) => {
  console.error('执行失败：', e);
  process.exit(1);
});
