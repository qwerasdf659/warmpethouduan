/**
 * B2 验收：每日对账作业（连真库，自建自清）。
 *
 * [A] 干净状态下报告 ok
 * [B] 手工 SQL 改余额不补流水 → 被抓出来（这正是加这个作业的理由）
 * [C] 有流水没钱包行（孤儿）→ 被抓出来
 * [D] 定时任务确实注册进了调度器，且单实例守卫按 NODE_APP_INSTANCE 生效
 *
 * 用法：node scripts/p2-verify-reconcile.js   （需先 npm run build）
 */
const P = '/home/devbox/project/node_modules/';
require(P + 'dotenv').config({ path: '/home/devbox/project/.env' });
const { Client } = require(P + 'pg');

const dist = '/home/devbox/project/dist/';
const { NestFactory } = require(P + '@nestjs/core');
const { SchedulerRegistry } = require(P + '@nestjs/schedule');
const { AppModule } = require(dist + 'app.module');
const { ReconcileService } = require(dist + 'economy/reconcile.service');

async function main() {
  const pg = new Client({
    host: process.env.DB_HOST,
    port: +process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await pg.connect();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const reconcile = app.get(ReconcileService);
  const scheduler = app.get(SchedulerRegistry);

  let userId = null;
  try {
    const clean = await reconcile.run();
    console.log(
      `[A] 基线：${clean.walletCount} 个钱包，ok=${clean.ok}` +
        (clean.ok
          ? ' ✓'
          : ` 不平 ${clean.mismatches.length} 条 ← 库里本来就有历史问题`),
    );

    // [B] 制造「改了余额没补流水」
    const openid = `recon_${Date.now()}`;
    userId = (
      await pg.query(
        `INSERT INTO "user" (openid, status) VALUES ($1,'active') RETURNING id`,
        [openid],
      )
    ).rows[0].id;
    await pg.query(
      `INSERT INTO wallet (user_id, game_coin, marketing_point) VALUES ($1, 777, 0)`,
      [userId],
    );

    const dirty = await reconcile.run();
    const hit = dirty.mismatches.find((m) => m.userId === String(userId));
    console.log(
      hit
        ? `[B] ✓ 抓到手工改余额：user=${hit.userId} pool=${hit.pool} wallet=${hit.wallet} ledger=${hit.ledgerSum} diff=${hit.diff}`
        : `[B] ✗ 没抓到 —— 对账等于没用`,
    );

    // [C] 孤儿流水：有 ledger 行但钱包被删
    await pg.query(
      `INSERT INTO ledger (user_id, pool, delta, balance_after, biz_id, reason)
       VALUES ($1, 'game', 10, 10, 'recon-orphan', 'compensation')`,
      [userId],
    );
    await pg.query(`DELETE FROM wallet WHERE user_id = $1`, [userId]);
    const orphan = await reconcile.run();
    console.log(
      orphan.orphanLedgerUsers.includes(String(userId))
        ? `[C] ✓ 抓到孤儿流水（钱包行被删但流水还在）`
        : `[C] ✗ 没抓到孤儿流水`,
    );

    // [D] 调度器注册与单实例守卫
    const jobs = [...scheduler.getCronJobs().keys()];
    console.log(
      `[D] 已注册定时任务：${jobs.join(', ') || '（无）'} ${jobs.includes('daily-reconcile') ? '✓' : '✗'}`,
    );
    const saved = process.env.NODE_APP_INSTANCE;
    process.env.NODE_APP_INSTANCE = '3';
    const t0 = Date.now();
    await reconcile.daily();
    const skipped = Date.now() - t0 < 50;
    process.env.NODE_APP_INSTANCE = saved;
    console.log(
      skipped
        ? '    ✓ 非 0 号 worker 直接跳过（不会 N 份重复跑）'
        : '    ✗ 非 0 号 worker 也在跑',
    );
  } finally {
    if (userId) {
      await pg.query(`DELETE FROM ledger WHERE user_id = $1`, [userId]);
      await pg.query(`DELETE FROM wallet WHERE user_id = $1`, [userId]);
      await pg.query(`DELETE FROM "user" WHERE id = $1`, [userId]);
      console.log(`\n已清理临时用户 ${userId}`);
    }
    const final = await reconcile.run();
    console.log(`清理后复查：ok=${final.ok}`);
    await pg.end();
    process.exit(0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
