/**
 * B5-6 / B5-8 实测：后台补发物品 + 履约时间落列。
 *
 * 在应用上下文里直接调 Service（绕开后台登录，不改任何凭证配置），验四件事：
 *   A. 补发物品真的进背包，重复补发按数量累加；
 *   B. 补发已下架物品也允许（限定款下架后仍要能补）；
 *   C. 发货写 shipped_at、取消写 cancelled_at，且不是靠 updated_at 近似；
 *   D. 改备注后 updated_at 会变、shipped_at 不变（这正是单开列的理由）。
 *
 * 用法：npm run build && node scripts/b5-verify-admin-grant.js
 */
const P = '/home/devbox/project/node_modules/';
require(P + 'dotenv').config({ path: '/home/devbox/project/.env' });
const { Client } = require(P + 'pg');
const { NestFactory } = require(P + '@nestjs/core');

function db() {
  return new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
}

let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
}

async function main() {
  const { AppModule } = require('/home/devbox/project/dist/app.module');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const {
    AdminPlayersService,
  } = require('/home/devbox/project/dist/admin/ops/admin-players.service');
  const {
    AdminExchangeService,
  } = require('/home/devbox/project/dist/admin/ops/admin-exchange.service');
  const {
    AdminItemsService,
  } = require('/home/devbox/project/dist/admin/ops/admin-items.service');
  const players = app.get(AdminPlayersService);
  const exchange = app.get(AdminExchangeService);
  const items = app.get(AdminItemsService);

  const c = db();
  await c.connect();
  const openid = `b5_grant_${Date.now()}`;
  const userId = (
    await c.query(
      `insert into "user" (openid, status) values ($1,'active') returning id`,
      [openid],
    )
  ).rows[0].id;

  try {
    // ---------------------------------------------------------- A. 补发物品
    const first = await players.grantItem(userId, {
      bizId: 'b5-g1',
      itemKey: 'skin_tiger',
      qty: 2,
    });
    check('补发 2 件皮肤进背包', first.qty === 2, `qty=${first.qty}`);

    const second = await players.grantItem(userId, {
      bizId: 'b5-g2',
      itemKey: 'skin_tiger',
      qty: 1,
    });
    check('再补发 1 件按数量累加', second.qty === 3, `qty=${second.qty}`);

    const bg = await players.grantItem(userId, {
      bizId: 'b5-g3',
      itemKey: 'bg_starry',
    });
    check('背景（bg 槽）可补发', bg.qty === 1 && bg.granted === 1);

    // ------------------------------------------------- B. 下架物品仍可补发
    await c.query(`update item_def set enabled = false where key = 'acc_cap'`);
    let downOk = true;
    try {
      await players.grantItem(userId, { bizId: 'b5-g4', itemKey: 'acc_cap' });
    } catch (e) {
      downOk = false;
      console.log('   下架补发报错：', e.message);
    } finally {
      await c.query(`update item_def set enabled = true where key = 'acc_cap'`);
    }
    check('已下架物品也能补发（限定款场景）', downOk);

    let missingRejected = false;
    try {
      await players.grantItem(userId, {
        bizId: 'b5-g5',
        itemKey: 'not_exist_key',
      });
    } catch {
      missingRejected = true;
    }
    check('不存在的 itemKey 被拒', missingRejected);

    const catalog = await items.grantable();
    const hasBg = catalog.list.some((i) => i.slot === 'bg');
    check('补发目录含 bg 槽物品，且不带价格字段', hasBg && !('price' in catalog.list[0]));

    // -------------------------------------------------- C/D. 履约时间落列
    const orderId = (
      await c.query(
        `insert into redeem_order
           (user_id, exchange_key, item_name, item_type, cost, pool, status, biz_id)
         values ($1,'coupon_5','5 元代金券','virtual',0,'marketing','pending',$2)
         returning id`,
        [userId, `b5-order-${Date.now()}`],
      )
    ).rows[0].id;

    await exchange.ship(orderId, { trackingNo: 'SF-B5-001' });
    const shipped = (
      await c.query(
        `select shipped_at, cancelled_at, updated_at from redeem_order where id=$1`,
        [orderId],
      )
    ).rows[0];
    check('发货写入 shipped_at', shipped.shipped_at !== null);
    check('发货不写 cancelled_at', shipped.cancelled_at === null);

    // 改备注：updated_at 会动，shipped_at 必须不动
    await new Promise((r) => setTimeout(r, 1100));
    await c.query(
      `update redeem_order set remark = '客服补充说明', updated_at = now() where id=$1`,
      [orderId],
    );
    const afterRemark = (
      await c.query(
        `select shipped_at, updated_at from redeem_order where id=$1`,
        [orderId],
      )
    ).rows[0];
    check(
      '改备注后 shipped_at 不变（这是单开列的理由）',
      afterRemark.shipped_at.getTime() === shipped.shipped_at.getTime() &&
        afterRemark.updated_at.getTime() > shipped.updated_at.getTime(),
    );

    // 取消要走退款，cost 必须非零（economy 不接受 0 变动）
    await c.query(
      `insert into wallet (user_id, game_coin, marketing_point) values ($1,0,0)
       on conflict (user_id) do update set marketing_point = 0`,
      [userId],
    );
    const cancelId = (
      await c.query(
        `insert into redeem_order
           (user_id, exchange_key, item_name, item_type, cost, pool, status, biz_id)
         values ($1,'coupon_5','5 元代金券','virtual',500,'marketing','pending',$2)
         returning id`,
        [userId, `b5-order-c-${Date.now()}`],
      )
    ).rows[0].id;
    await exchange.cancel(cancelId, { reason: '缺货' });
    const cancelled = (
      await c.query(
        `select shipped_at, cancelled_at from redeem_order where id=$1`,
        [cancelId],
      )
    ).rows[0];
    check('取消写入 cancelled_at', cancelled.cancelled_at !== null);
    check('取消不写 shipped_at', cancelled.shipped_at === null);
  } catch (e) {
    // 不能让意外异常被 finally 的 exit(0) 吞掉，那样脚本会假装全绿
    failures++;
    console.log('✗ 脚本异常中断：', e.message);
  } finally {
    for (const t of ['redeem_order', 'item_owned', 'ledger', 'wallet']) {
      await c.query(`delete from ${t} where user_id = $1`, [userId]);
    }
    await c.query(`delete from "user" where id = $1`, [userId]);
    await c.end();
    await app.close();
    console.log(failures ? `\n${failures} 项未通过` : '\n全部通过');
    process.exit(failures ? 1 : 0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
