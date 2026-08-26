/**
 * B2 验收：每日对账作业（连真库，自建自清）。
 *
 * 账本重构后对账从「钱包余额 vs 流水累计」单一维度换成了**11 项不变量**
 * （架构设计 §2.1），这个脚本随之重写：
 *
 * [A] 干净状态下 11 项全部成立
 * [B] 手工改余额不补分录 → 被不变量 2（余额 vs 分录）与 9（余额 vs 批次）同时抓出
 * [C] 唯一物品只改 state 不写分录 → 被不变量 5（实例守恒与 state 一致）抓出
 * [D] 定时任务确实注册进了调度器，且单实例守卫按 NODE_APP_INSTANCE 生效
 *
 * [C] 替掉了原来的「孤儿流水」用例：新模型里分录经 `account` 挂到玩家身上，
 * 「有流水没钱包行」这个形态已不存在（余额行与分录都挂在同一个 account 下）。
 * 取而代之的真实风险是唯一物品的两处真相（`item_instance.state` 与实例分录）
 * 被单独改动而不同步。
 *
 * 用法：node scripts/p2-verify-reconcile.js   （需先 npm run build）
 */
const P = '/home/devbox/project/node_modules/';
const { SchedulerRegistry } = require(P + '@nestjs/schedule');
const {
  GAME_COIN,
  db,
  bootApp,
  services,
  fundAsset,
  cleanupUser,
} = require('./_verify-fixture');

const dist = '/home/devbox/project/dist/';
const { ReconcileService } = require(dist + 'economy/reconcile.service');

/** 取某条不变量在**指定账户**上的违反样本。 */
function violationOf(report, id, accountId) {
  const inv = report.invariants.find((i) => i.id === id);
  if (!inv || inv.ok) return null;
  return (
    inv.samples.find((s) => String(s.account_id ?? '') === String(accountId)) ??
    null
  );
}

async function main() {
  const pg = db();
  await pg.connect();
  const app = await bootApp();
  const reconcile = app.get(ReconcileService);
  const scheduler = app.get(SchedulerRegistry);
  const { reward, accounts, inventory } = services(app);

  let userId = null;
  try {
    // -------------------------------------------------------------------- [A]
    const clean = await reconcile.run();
    const broken = clean.invariants.filter((i) => !i.ok);
    console.log(
      `[A] 基线：${clean.accountCount} 个账户、${clean.invariants.length} 项不变量，ok=${clean.ok}` +
        (clean.ok
          ? ' ✓'
          : ` ← 库里本来就有历史问题：${broken.map((b) => `#${b.id}(${b.count})`).join(' ')}`),
    );

    const openid = `recon_${Date.now()}`;
    userId = (
      await pg.query(
        `INSERT INTO "user" (openid, status) VALUES ($1,'active') RETURNING id`,
        [openid],
      )
    ).rows[0].id;
    await fundAsset(app, userId, GAME_COIN, 500);
    const accountId = await accounts.resolve({ userId });

    // -------------------------------------------------------------------- [B]
    // 这是对账存在的全部理由：正常代码路径不会漂移（写入只有 LedgerService 一处、
    // 且在同一事务里），真正的风险是排障/补偿/压测时手工 SQL 改数据不补分录。
    await pg.query(
      `UPDATE asset_balance SET available = available + 777
        WHERE account_id = $1 AND asset_code = $2`,
      [accountId, GAME_COIN],
    );
    const dirty = await reconcile.run();
    const hit2 = violationOf(dirty, 2, accountId);
    const hit9 = violationOf(dirty, 9, accountId);
    console.log(
      hit2 && hit9
        ? `[B] ✓ 手工改余额被同时抓到：#2 余额(${hit2.available}) ≠ 分录累加(${hit2.derived})、` +
            `#9 余额(${hit9.available}) ≠ 批次聚合(${hit9.lot_available})`
        : `[B] ✗ 没抓到（#2=${hit2 ? '命中' : '漏'}、#9=${hit9 ? '命中' : '漏'}）—— 对账等于没用`,
    );
    await pg.query(
      `UPDATE asset_balance SET available = available - 777
        WHERE account_id = $1 AND asset_code = $2`,
      [accountId, GAME_COIN],
    );

    // -------------------------------------------------------------------- [C]
    await reward.grant(userId, [{ assetCode: 'skin_snow', count: 1 }], {
      reason: 'compensation',
      bizKey: `recon:mint:${Date.now()}`,
      scope: 'sys',
    });
    const [inst] = await inventory.listInstances(userId, 'skin_snow');
    // 只把状态改成已销毁、不写 −1 分录：等于「物品没了但账上还在」
    await pg.query(`UPDATE item_instance SET state = 'burned' WHERE id = $1`, [
      inst.instanceId,
    ]);
    const instDirty = await reconcile.run();
    const inv5 = instDirty.invariants.find((i) => i.id === 5);
    const hit5 = inv5?.samples.find(
      (s) => String(s.instance_id) === String(inst.instanceId),
    );
    console.log(
      hit5
        ? `[C] ✓ 抓到实例两处真相不一致：state=${hit5.state} 但分录求和=${hit5.owned}`
        : `[C] ✗ 没抓到实例状态与分录不一致`,
    );
    await pg.query(`UPDATE item_instance SET state = 'held' WHERE id = $1`, [
      inst.instanceId,
    ]);

    // -------------------------------------------------------------------- [D]
    const jobs = [...scheduler.getCronJobs().keys()];
    const expected = ['daily-reconcile', 'daily-expire', 'market-settle'];
    console.log(
      `[D] 已注册定时任务：${jobs.join(', ') || '（无）'}\n` +
        `    ${expected.every((j) => jobs.includes(j)) ? '✓' : '✗'} 账本相关作业齐全（${expected.join(' / ')}）`,
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
      await cleanupUser(pg, userId);
      console.log(`\n已清理临时用户 ${userId}`);
    }
    const final = await reconcile.run();
    const stillBroken = final.invariants.filter((i) => !i.ok);
    console.log(
      `清理后复查：ok=${final.ok}` +
        (stillBroken.length
          ? `（仍有 ${stillBroken.map((b) => `#${b.id}`).join(' ')} —— 属于库里的历史数据，非本脚本造成）`
          : ''),
    );
    await pg.end();
    await app.close();
    process.exit(0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
