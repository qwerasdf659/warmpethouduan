/**
 * 上线前清档：删除**全部**玩家账号与其业务数据，把库恢复成「有配置、无玩家」。
 *
 *   npm run wipe:pre-launch                    # 预演，只报数不删
 *   npm run wipe:pre-launch -- --execute       # 真删（需手输确认短语）
 *   npm run wipe:pre-launch -- --execute --keep 1,2   # 保留指定 userId
 *
 * 保留：admin_*（后台账号权限）、game_config / asset_def 等配置表、migrations。
 * 清除：user 及所有沿外键挂在它下面的表，外加三样 `sweep` 沿外键走不到的：
 * 变成孤儿的凭证头（`asset_txn`）、无外键的派生统计（`asset_daily_stat`）、
 * 以及与实际实例对不上的限量发行计数（`asset_def.minted_count`）。
 *
 * ⚠ 系统账户（`FEE`/`ESCROW`）本身保留（由启动播种保证存在），但它们名下的余额与
 * 托管实例会随账户表一起被 sweep 清掉 —— 那些是交易产生的手续费与托管物，
 * 玩家都删了它们也无处归属。
 *
 * 三道闸：生产环境直接拒绝、默认 dry-run、真删前必须手输确认短语。
 * 清档不可逆且没有回滚入口，任何一道都不该省。
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import {
  makeClient,
  printCounts,
  refuseInProduction,
  sweep,
  sweepOrphans,
  type SweepCounts,
} from './_db';

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
    console.log('  不动的表：admin_*、game_config、asset_def、migrations\n');

    /*
     * 没有玩家可删时**不能直接返回**：派生统计（`asset_daily_stat`）与限量发行计数
     * 与玩家表无关，它们会在每一轮 e2e / 冒烟之后留下残值。清档的语义是
     * 「把库恢复成有配置、无玩家」，这件事必须是幂等的 —— 跑第二遍应该也能把
     * 上一遍之后新积的残值收掉，而不是看一眼玩家数就走。
     */
    if (rows.length === 0) {
      console.log('没有需要清除的玩家，仅收敛派生数据。');
      if (!execute) {
        const preview = await previewDerived(client);
        printCounts(preview, '清除');
        console.log(
          '\n以上为预演，未改动数据。确认后执行：npm run wipe:pre-launch -- --execute\n',
        );
        return;
      }
      await client.query('BEGIN');
      const counts: SweepCounts = new Map();
      await sweepOrphans(client, 'asset_txn', { dryRun: false, counts });
      await clearDerivedStats(client, counts);
      await resyncMintedCount(client);
      await client.query('COMMIT');
      printCounts(counts, '删除');
      console.log('\n✓ 派生数据已收敛。\n');
      return;
    }

    const ids = rows.map((r) => r.id);

    // 无论是否真删都先跑一遍预演，让确认短语是在**看过影响面之后**才输入的
    await client.query('BEGIN');
    const preview = await sweep(client, 'user', 'id', ids, {
      dryRun: true,
      counts: new Map(),
    });
    await sweepOrphans(client, 'asset_txn', {
      dryRun: true,
      counts: preview,
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
    // 凭证头只有在分录与实例都删完之后才变成孤儿，顺序不能提前
    await sweepOrphans(client, 'asset_txn', { dryRun: false, counts });
    await clearDerivedStats(client, counts);
    await resyncMintedCount(client);
    await client.query('COMMIT');

    console.log('\n已清除：');
    printCounts(counts, '删除');
    console.log('\n✓ 清档完成。\n');
  } finally {
    await client.end();
  }
}

/**
 * 「无玩家可删」分支的预演：只数派生数据，不碰玩家表。
 */
async function previewDerived(
  client: ReturnType<typeof makeClient>,
): Promise<SweepCounts> {
  const counts: SweepCounts = new Map();
  await sweepOrphans(client, 'asset_txn', { dryRun: true, counts });
  const stats = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM "asset_daily_stat"`,
  );
  const n = Number(stats.rows[0].n);
  if (n > 0) counts.set('asset_daily_stat', n);
  const drifted = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM "asset_def" d
      WHERE d."minted_count" <> GREATEST(
              (SELECT COUNT(*) FROM "item_instance" i WHERE i."asset_code" = d."code"),
              COALESCE((SELECT MAX(i."serial") FROM "item_instance" i
                         WHERE i."asset_code" = d."code"), 0))`,
  );
  const m = Number(drifted.rows[0].n);
  if (m > 0) console.log(`  限量发行计数待重置：${m} 项`);
  return counts;
}

/**
 * 清掉派生统计表。
 *
 * `asset_daily_stat` 是每日对账物化出来的发行/销毁日报，**没有任何外键** ——
 * 它既不指向 `user` 也不指向 `account`，所以 `sweep` 沿外键永远走不到它。
 * 不清的话，清档后「发行日报」页展示的还是清档前那批测试数据的发行量，
 * 而那些玩家已经不存在了。
 */
async function clearDerivedStats(
  client: ReturnType<typeof makeClient>,
  counts: SweepCounts,
): Promise<void> {
  const res = await client.query(`DELETE FROM "asset_daily_stat"`);
  const n = res.rowCount ?? 0;
  if (n > 0) counts.set('asset_daily_stat', n);
}

/**
 * 把限量资产的已发行计数与**实际存在的实例**对齐。
 *
 * `asset_def.minted_count` 是限量编号的单调分配器（每铸造一件 +1，序号即当前值）。
 * 清档删掉实例行之后它不会自己退回去，于是会出现「skin_aurora 已发行 42/100，
 * 但库里 0 件」——上线后第一个买到的玩家拿到「第 43/100 件」，
 * 而 42 个编号在没有任何人持有的情况下永久损失。
 *
 * 取 `COUNT` 与 `MAX(serial)` 的较大值而不是直接归零：`--keep` 保留的玩家可能
 * 正持有某个编号，归零会让下一次铸造重新发出同一个编号，
 * 撞上 `uq_instance_serial` 唯一索引。
 *
 * 已销毁（`state='burned'`）的实例行仍然计入 —— 它们确实占用过一个编号，
 * 而生产环境里实例行永不物理删除。
 */
async function resyncMintedCount(
  client: ReturnType<typeof makeClient>,
): Promise<void> {
  const { rows } = await client.query<{
    code: string;
    before: string;
    after: string;
  }>(
    `UPDATE "asset_def" d
        SET "minted_count" = GREATEST(
              (SELECT COUNT(*) FROM "item_instance" i WHERE i."asset_code" = d."code"),
              COALESCE((SELECT MAX(i."serial") FROM "item_instance" i
                         WHERE i."asset_code" = d."code"), 0)
            )
      WHERE d."minted_count" <> GREATEST(
              (SELECT COUNT(*) FROM "item_instance" i WHERE i."asset_code" = d."code"),
              COALESCE((SELECT MAX(i."serial") FROM "item_instance" i
                         WHERE i."asset_code" = d."code"), 0)
            )
      RETURNING d."code", d."minted_count"::text AS after, '' AS before`,
  );
  if (rows.length > 0) {
    console.log(
      `\n已重置限量发行计数（${rows.length} 项）：` +
        rows.map((r) => `${r.code}→${r.after}`).join('、'),
    );
  }
}

main().catch((err: unknown) => {
  console.error('✗ 清档失败：', err instanceof Error ? err.message : err);
  process.exit(1);
});
