/**
 * 清掉全部假登录测试玩家及其所有关联数据。
 *
 *   npm run clean:dev            # 先看要删什么（dry-run）
 *   npm run clean:dev -- --yes   # 真删
 *
 * 圈定范围靠 openid 前缀 `mock_openid_`，这是假登录唯一的产号方式，
 * 所以「测试号」是可精确识别的集合，不会误伤真实玩家 —— 真实 openid 由微信下发，
 * 不可能长这样。
 *
 * 关联数据不写死表名，由 `sweep` 沿外键递归发现，新增业务表自动纳入。
 */
import { makeClient, printCounts, refuseInProduction, sweep } from './_db';
import { MOCK_OPENID_PREFIX } from '../../src/wechat/wechat.service';

async function main(): Promise<void> {
  refuseInProduction('clean:dev');

  const execute = process.argv.includes('--yes');
  const client = makeClient();
  await client.connect();

  try {
    const { rows } = await client.query<{ id: string; openid: string }>(
      `SELECT "id", "openid" FROM "user" WHERE "openid" LIKE $1 ORDER BY "id"`,
      [`${MOCK_OPENID_PREFIX}%`],
    );

    if (rows.length === 0) {
      console.log('\n没有假登录测试玩家，无需清理。\n');
      return;
    }

    console.log(
      `\n${execute ? '清理' : '待清理'}测试玩家 ${rows.length} 个（DB=${process.env.DB_NAME}）：`,
    );
    for (const r of rows) {
      console.log(`  id=${String(r.id).padStart(4)}  ${r.openid}`);
    }

    const ids = rows.map((r) => r.id);
    console.log('');

    // 整体一个事务：中途失败不留半清理状态
    await client.query('BEGIN');
    const counts = await sweep(client, 'user', 'id', ids, {
      dryRun: !execute,
      counts: new Map(),
    });
    await client.query(execute ? 'COMMIT' : 'ROLLBACK');

    printCounts(counts, execute ? '删除' : '清理');

    console.log(
      execute
        ? '\n✓ 清理完成。\n'
        : '\n以上为预演，未改动数据。确认无误后加 --yes 执行：npm run clean:dev -- --yes\n',
    );
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error('✗ 清理失败：', err instanceof Error ? err.message : err);
  process.exit(1);
});
