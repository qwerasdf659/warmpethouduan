/**
 * 只读体检：迁移是否跑齐、配置中心是否与代码注册表对齐。
 *
 * 替掉文档里那几条 `psql ... | jq ...` —— 它们依赖本机没装的 psql/jq，
 * 属于「写在核对清单里但没人跑得起来」的装饰性步骤。这里改成走项目自带的 pg 依赖，
 * 且因为放在 scripts/dev/ 下，受 lint 与 tsc --noEmit 两道卡口约束，不会悄悄腐坏。
 *
 * 用法：npm run audit
 */
import 'dotenv/config';
import { readdirSync } from 'fs';
import { join } from 'path';
import { CONFIG_REGISTRY } from '../../src/config/game-config.registry';
import { makeClient } from './_db';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'src', 'migrations');

/** 有任何一项不一致就以非 0 退出，方便挂进 CI 或发版前脚本。 */
let problems = 0;

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`);
}

function bad(msg: string): void {
  problems += 1;
  console.log(`  ✗ ${msg}`);
}

async function auditMigrations(
  client: ReturnType<typeof makeClient>,
): Promise<void> {
  console.log('\n迁移');
  const onDisk = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => f.replace(/\.ts$/, ''));

  const { rows } = await client.query<{ name: string }>(
    `SELECT name FROM migrations ORDER BY timestamp`,
  );
  const applied = new Set(rows.map((r) => r.name));

  // migrations 表里存的是类名+时间戳（如 DropHomeStat1787900000011），
  // 文件名是 时间戳-类名，两边形态不同，只能按「类名 + 时间戳」拼出来比。
  const pending = onDisk.filter((f) => {
    const [ts, cls] = [f.slice(0, f.indexOf('-')), f.slice(f.indexOf('-') + 1)];
    return !applied.has(`${cls}${ts}`);
  });

  if (pending.length === 0) {
    ok(`${onDisk.length} 个迁移文件全部已应用`);
  } else {
    bad(`${pending.length} 个迁移未应用：${pending.join(', ')}`);
  }
}

/**
 * 递归按键名排序后再序列化。
 *
 * 直接 `JSON.stringify` 比较会把「键顺序不同、内容完全一样」判成有差异：
 * jsonb 读回来的键序由 Postgres 决定（短键在前），和代码字面量的书写顺序基本不可能一致。
 * 头一版就是这么写的，28 项里报了 17 项「不同」，其中 15 项纯属键序 ——
 * 一个天天喊狼来了的检查，等于没有这个检查。
 */
function canonical(v: unknown): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === 'object') {
      return Object.fromEntries(
        Object.entries(x as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, val]) => [k, sort(val)]),
      );
    }
    return x;
  };
  return JSON.stringify(sort(v));
}

async function auditConfig(
  client: ReturnType<typeof makeClient>,
): Promise<void> {
  console.log('\n配置中心');
  const codeKeys = Object.keys(CONFIG_REGISTRY);
  const { rows } = await client.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM game_config`,
  );
  const dbKeys = new Set(rows.map((r) => r.key));

  const missing = codeKeys.filter((k) => !dbKeys.has(k));
  if (missing.length === 0) {
    ok(`${codeKeys.length} 个注册项已全部播种`);
  } else {
    // 正常情况下启动时会自动补种，还缺就说明播种没跑或失败了
    bad(
      `${missing.length} 项未播种（后台配置页看不到）：${missing.join(', ')}`,
    );
  }

  // 代码里已删掉、DB 里还留着的孤儿行：后台仍能改，但改了没有任何代码会读
  const orphans = [...dbKeys].filter((k) => !codeKeys.includes(k));
  if (orphans.length === 0) {
    ok('无孤儿配置行');
  } else {
    bad(`${orphans.length} 个孤儿键（代码已无消费方）：${orphans.join(', ')}`);
  }

  // 注意别把这个数当成「运营改了多少」：迁移改存量行（如收藏品重标定价、
  // 给已有 key 补必填字段）同样会让 DB 值偏离代码默认值。这里只报告偏离事实，
  // 不猜偏离的来源 —— 要追来源看审计日志。
  const drifted = rows.filter((r) => {
    const entry = CONFIG_REGISTRY[r.key as keyof typeof CONFIG_REGISTRY] as
      { default: unknown } | undefined;
    return entry && canonical(entry.default) !== canonical(r.value);
  });
  console.log(
    drifted.length === 0
      ? '  · 所有项与代码默认值一致'
      : `  · ${drifted.length} 项与代码默认值不同（迁移改的或运营改的）：` +
          drifted.map((m) => m.key).join(', '),
  );
}

async function main(): Promise<void> {
  const client = makeClient();
  await client.connect();
  try {
    await auditMigrations(client);
    await auditConfig(client);
  } finally {
    await client.end();
  }

  console.log(
    problems === 0 ? '\n✅ 状态一致' : `\n❌ ${problems} 项不一致，见上`,
  );
  process.exit(problems === 0 ? 0 : 1);
}

void main();
