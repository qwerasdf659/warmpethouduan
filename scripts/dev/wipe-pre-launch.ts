/**
 * 上线前清档：删除**全部**玩家账号与其业务数据，把库恢复成「有配置、无玩家」。
 *
 *   npm run wipe:pre-launch                    # 预演，只报数不删
 *   npm run wipe:pre-launch -- --execute       # 真删（需手输确认短语）
 *   npm run wipe:pre-launch -- --execute --keep 1,2   # 保留指定 userId
 *
 * 保留：admin_*（后台账号权限）、game_config / item_def 等配置表、migrations。
 * 清除：user 及所有沿外键挂在它下面的表。
 *
 * 三道闸：生产环境直接拒绝、默认 dry-run、真删前必须手输确认短语。
 * 清档不可逆且没有回滚入口，任何一道都不该省。
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { makeClient, printCounts, refuseInProduction, sweep } from './_db';

const CONFIRM_PHRASE = '确认清档';

function parseKeepIds(argv: string[]): string[] {
  const i = argv.indexOf('--keep');
  if (i === -1) return [];
  const raw = argv[i + 1];
  if (!raw) throw new Error('--keep 需要跟一串 userId，例如 --keep 1,2');
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.some((s) => !/^\d+$/.test(s))) {
    throw new Error(`--keep 只接受数字 userId，收到：${raw}`);
  }
  return ids;
}

async function main(): Promise<void> {
  refuseInProduction('wipe:pre-launch');

  const execute = process.argv.includes('--execute');
  const keepIds = parseKeepIds(process.argv);
  const client = makeClient();
  await client.connect();

  try {
    const { rows } = await client.query<{ id: string }>(
      keepIds.length
        ? `SELECT "id" FROM "user" WHERE NOT ("id" = ANY($1)) ORDER BY "id"`
        : `SELECT "id" FROM "user" ORDER BY "id"`,
      keepIds.length ? [keepIds] : [],
    );

    console.log(`\n上线前清档（DB=${process.env.DB_NAME}）`);
    console.log(`  待删玩家：${rows.length} 个`);
    if (keepIds.length) console.log(`  保留玩家：userId ${keepIds.join(', ')}`);
    console.log('  不动的表：admin_*、game_config、item_def、migrations\n');

    if (rows.length === 0) {
      console.log('没有需要清除的玩家。\n');
      return;
    }

    const ids = rows.map((r) => r.id);

    // 无论是否真删都先跑一遍预演，让确认短语是在**看过影响面之后**才输入的
    await client.query('BEGIN');
    const preview = await sweep(client, 'user', 'id', ids, {
      dryRun: true,
      counts: new Map(),
    });
    await client.query('ROLLBACK');

    console.log('影响面：');
    printCounts(preview, '清除');

    if (!execute) {
      console.log(
        '\n以上为预演，未改动数据。确认后执行：npm run wipe:pre-launch -- --execute\n',
      );
      return;
    }

    const rl = createInterface({ input: stdin, output: stdout });
    const answer = await rl.question(
      `\n⚠ 此操作不可逆。确认请输入「${CONFIRM_PHRASE}」：`,
    );
    rl.close();

    if (answer.trim() !== CONFIRM_PHRASE) {
      console.log('\n输入不匹配，已中止，未改动任何数据。\n');
      process.exitCode = 1;
      return;
    }

    await client.query('BEGIN');
    const counts = await sweep(client, 'user', 'id', ids, {
      dryRun: false,
      counts: new Map(),
    });
    await client.query('COMMIT');

    console.log('\n已清除：');
    printCounts(counts, '删除');
    console.log('\n✓ 清档完成。\n');
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error('✗ 清档失败：', err instanceof Error ? err.message : err);
  process.exit(1);
});
