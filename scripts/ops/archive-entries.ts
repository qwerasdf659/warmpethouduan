/**
 * 分录归档：把超出保留窗口的 `asset_entry` 月度分区 DETACH 下来、转储到对象存储。
 *
 * **这是生产运维工具，不是开发脚本** —— 所以它不像 `scripts/dev/*` 那样
 * `refuseInProduction`，它本来就要在生产跑。放在 `scripts/ops/` 就是为了让这个
 * 区别在目录上可见。
 *
 * 为什么归档必须人工执行、而不是挂个 Cron：每一步都不可逆。定时任务在无人值守时
 * 做不可逆操作，是「自动化把事情搞坏」的经典形态。`PartitionService` 每月只负责
 * **告警**（哪些分区超期了），动手的入口是这里，且默认 dry-run。
 *
 * 三条硬约束（对应架构设计 §4.4 与决策 D9）：
 *  1. **禁止 DELETE**。分区级 `DETACH` + 转储，永不做行级删除 —— 物理删除会摧毁
 *     回档能力，而游戏出重大事故（数值配错、外挂刷币）需要回档。
 *  2. **转储未经校验就不删任何东西**。上传后读回比对大小，不过就停在
 *     「已 DETACH、已落本地文件、未删表」这个可人工接管的状态。
 *  3. **`asset_entry_default` 永不归档**。它是兜底分区、没有确定时间范围，
 *     搬走它等于把不知哪个月的数据搬走。
 *
 * 用法：
 *   npm run archive:entries                                  # 预演，只列清单
 *   npm run archive:entries -- --execute                     # DETACH + 转储（保留已摘下的表）
 *   npm run archive:entries -- --execute --drop               # 转储校验通过后再删表
 *   npm run archive:entries -- --keep-months 12 --execute     # 自定保留窗口
 *   npm run archive:entries -- --execute --out /path/to/dir    # 自定本地落盘目录
 */
import 'dotenv/config';
import { gzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Client } from 'pg';
import {
  headObject,
  putObjectVerified,
  s3ConfigFromEnv,
  type S3Config,
} from './s3';

const CONFIRM_PHRASE = '确认归档';
const DEFAULT_KEEP_MONTHS = 24;
const DEFAULT_OUT_DIR = '/home/devbox/project/logs/archive';

interface Partition {
  table: string;
  month: string;
  rows: number;
  size: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function makeClient(): Client {
  return new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
}

/**
 * 超期分区清单。
 *
 * 与 `PartitionService.archiveCandidates()` 同一判据（按分区名推月份）。刻意在这里
 * 重写一遍 SQL 而不引应用上下文：归档要在「应用可能已经停掉」的运维场景下能跑，
 * 拖一个 Nest 上下文进来只会多一堆失败可能。
 */
async function listExpired(
  c: Client,
  keepMonths: number,
): Promise<Partition[]> {
  const { rows } = await c.query<{
    table: string;
    month: string;
    rows: string;
    size: string;
  }>(
    `SELECT c.relname AS table,
            substring(c.relname from 'asset_entry_(\\d{4}_\\d{2})$') AS month,
            COALESCE(s.n_live_tup, 0)::text AS rows,
            pg_size_pretty(pg_total_relation_size(c.oid)) AS size
       FROM pg_class c
       LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
      WHERE c.relkind = 'r'
        AND c.relname ~ '^asset_entry_\\d{4}_\\d{2}$'
        AND to_date(substring(c.relname from 'asset_entry_(\\d{4}_\\d{2})$'), 'YYYY_MM')
            < date_trunc('month', now()) - ($1 || ' months')::interval
      ORDER BY c.relname`,
    [String(keepMonths)],
  );
  return rows.map((r) => ({
    table: r.table,
    month: r.month,
    rows: Number(r.rows),
    size: r.size,
  }));
}

/**
 * 把一张（已摘下的）表导成 CSV 并 gzip。
 *
 * 用 `COPY ... TO STDOUT` 而不是 `pg_dump`：DevBox 里没装 pg_dump，而 COPY 走的是
 * 现成的 pg 连接。CSV 带表头，回档时 `COPY ... FROM` 可直接吃回去。
 */
async function dumpTable(c: Client, table: string): Promise<Buffer> {
  // pg 的 query 不支持 COPY TO STDOUT 的流式读取（那要 pg-copy-streams），
  // 所以改用 `COPY (SELECT ...) TO PROGRAM` 不可行（无权限）——
  // 这里退回最朴素可靠的做法：把行读进内存再序列化。
  // 单月分录量级（几十万行、几十 MB）下可接受；真到千万行级别应改用
  // pg-copy-streams 边读边写，那时这个函数是唯一要改的地方。
  const { rows, fields } = await c.query<Record<string, unknown>>(
    `SELECT * FROM "${table}"`,
  );
  const header = fields.map((f) => f.name).join(',');
  const lines = rows.map((row) =>
    fields.map((f) => csvCell(row[f.name])).join(','),
  );
  return gzipSync(Buffer.from([header, ...lines].join('\n'), 'utf8'));
}

/**
 * 一个字段序列化成 CSV 单元格。
 *
 * 逐类型显式处理而不是一律 `String(v)`：`String()` 碰到对象会得到
 * `[object Object]` —— 归档文件里出现这种值，等于那一列数据在回档时已经丢了，
 * 而丢得很安静。当前 `asset_entry` 全是标量列，但归档脚本不该依赖这个前提。
 */
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (v instanceof Date) s = v.toISOString();
  else if (Buffer.isBuffer(v)) s = `\\x${v.toString('hex')}`;
  else if (typeof v === 'object') s = JSON.stringify(v);
  else if (typeof v === 'bigint') s = v.toString();
  else if (typeof v === 'number' || typeof v === 'boolean') s = String(v);
  else if (typeof v === 'string') s = v;
  else s = JSON.stringify(v);
  // CSV 转义：含逗号/引号/换行的字段加引号并把内部引号翻倍
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const drop = process.argv.includes('--drop');
  const keepMonths = Number(arg('keep-months') ?? DEFAULT_KEEP_MONTHS);
  const outDir = arg('out') ?? DEFAULT_OUT_DIR;

  if (!Number.isInteger(keepMonths) || keepMonths < 1) {
    throw new Error(
      `--keep-months 需为 ≥1 的整数，收到：${arg('keep-months')}`,
    );
  }

  const s3 = s3ConfigFromEnv();
  const c = makeClient();
  await c.connect();

  try {
    const expired = await listExpired(c, keepMonths);

    console.log(`\n分录归档（DB=${process.env.DB_NAME}）`);
    console.log(`  保留窗口：${keepMonths} 个月`);
    console.log(`  本地落盘：${outDir}`);
    console.log(
      `  对象存储：${
        s3
          ? `${s3.endpoint}/${s3.bucket}`
          : '未配置（SEALOS_* 缺失或仍是占位值）'
      }`,
    );
    console.log(
      `  删表：${drop ? '转储校验通过后删除已摘下的分区' : '不删（仅 DETACH + 转储）'}\n`,
    );

    if (expired.length === 0) {
      console.log('没有超出保留窗口的分区，无需归档。\n');
      return;
    }

    console.log('待归档分区：');
    for (const p of expired) {
      console.log(
        `  ${p.table.padEnd(24)} ${p.month.replace('_', '-')}  ${String(p.rows).padStart(9)} 行  ${p.size}`,
      );
    }

    if (!execute) {
      console.log(
        '\n以上为预演，未改动数据。确认后执行：npm run archive:entries -- --execute\n',
      );
      return;
    }

    if (drop && !s3) {
      // 没有对象存储时删表就只剩本地一份 gzip，机器一没就真丢了
      throw new Error(
        '--drop 需要配置对象存储（SEALOS_*）：只有本地一份转储时删除分区不安全',
      );
    }

    const rl = createInterface({ input: stdin, output: stdout });
    const answer = await rl.question(
      `\n⚠ 将 DETACH ${expired.length} 个分区${drop ? ' 并在校验通过后删除' : ''}。` +
        `此操作不可逆，确认请输入「${CONFIRM_PHRASE}」：`,
    );
    rl.close();
    if (answer.trim() !== CONFIRM_PHRASE) {
      console.log('\n输入不匹配，已中止，未改动任何数据。\n');
      process.exitCode = 1;
      return;
    }

    mkdirSync(outDir, { recursive: true });

    for (const p of expired) {
      console.log(`\n· ${p.table}`);

      // 1) DETACH：摘下来之后它就是一张普通表，主表的读写不再触碰它
      await c.query(`ALTER TABLE "asset_entry" DETACH PARTITION "${p.table}"`);
      console.log('  ✓ DETACH');

      // 2) 转储到本地
      const gz = await dumpTable(c, p.table);
      const fileName = `${p.table}.csv.gz`;
      const localPath = join(outDir, fileName);
      writeFileSync(localPath, gz);
      console.log(
        `  ✓ 转储 ${localPath}（${(gz.byteLength / 1024).toFixed(1)} KB）`,
      );

      // 3) 上传并读回校验
      if (s3) {
        const key = `ledger-archive/${fileName}`;
        await putObjectVerified(s3, key, gz);
        console.log(`  ✓ 上传并校验 ${s3.bucket}/${key}`);
      } else {
        console.log('  · 跳过上传（未配置对象存储）');
      }

      // 4) 只有在「转储已校验」的前提下才删表
      if (drop && s3) {
        await c.query(`DROP TABLE "${p.table}"`);
        console.log('  ✓ 已删除已摘下的分区（转储已在对象存储校验通过）');
      } else {
        console.log(
          '  · 保留已摘下的分区表（确认转储无误后可手动 DROP，或加 --drop 让脚本代劳）',
        );
      }
    }

    console.log(
      `\n✓ 归档完成：${expired.length} 个分区。` +
        (drop ? '' : '\n  已摘下的表仍在库里，占用空间但不再参与主表读写。') +
        '\n',
    );
  } finally {
    await c.end();
  }
}

/** 回档提示：出错时把「怎么把数据搬回去」写在错误旁边，而不是让人去翻文档。 */
main().catch((err: unknown) => {
  console.error('\n✗ 归档失败：', err instanceof Error ? err.message : err);
  console.error(
    '\n若已 DETACH 但未完成转储：分区表仍在库里（名字不变），可用\n' +
      "  ALTER TABLE asset_entry ATTACH PARTITION <表名> FOR VALUES FROM ('YYYY-MM-01') TO ('YYYY-MM-01');\n" +
      '把它挂回主表。数据一行都没动过。\n',
  );
  process.exit(1);
});

export type { Partition, S3Config };
export { headObject };
