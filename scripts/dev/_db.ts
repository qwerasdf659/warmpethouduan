/**
 * 开发数据脚本的共用底座：直连 pg + 按外键依赖递归清理。
 *
 * 为什么不写死一张「要删的表」清单：清单一定会随新表落后，而漏删的表不会报错，
 * 只会静默留下孤儿测试数据 —— 等到某天唯一索引冲突才暴露。这里改成运行时从
 * pg_constraint 反查依赖，新增表自动纳入清理范围，无需回来改脚本。
 */
import 'dotenv/config';
import { Client } from 'pg';

export function makeClient(): Client {
  return new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
}

interface ForeignKey {
  childTable: string;
  childColumn: string;
  parentColumn: string;
}

/** 每张表被删/待删的行数，按遍历顺序累计。 */
export type SweepCounts = Map<string, number>;

/**
 * 反查所有指向 `parentTable` 的外键。
 *
 * 复合外键会让「按单列 IN 集合」的删除语义失真，与其悄悄删错不如直接报错 ——
 * 当前 schema 没有复合外键，真加了必须回来显式处理。
 */
async function childForeignKeys(
  client: Client,
  parentTable: string,
): Promise<ForeignKey[]> {
  const { rows } = await client.query<{
    child_table: string;
    child_column: string;
    parent_column: string;
    col_count: string;
  }>(
    `SELECT con.conrelid::regclass::text AS child_table,
            att.attname                  AS child_column,
            patt.attname                 AS parent_column,
            array_length(con.conkey, 1)::text AS col_count
       FROM pg_constraint con
       JOIN unnest(con.conkey)  WITH ORDINALITY AS ck(attnum, ord) ON true
       JOIN unnest(con.confkey) WITH ORDINALITY AS pk(attnum, ord) ON pk.ord = ck.ord
       JOIN pg_attribute att  ON att.attrelid  = con.conrelid  AND att.attnum  = ck.attnum
       JOIN pg_attribute patt ON patt.attrelid = con.confrelid AND patt.attnum = pk.attnum
      WHERE con.contype = 'f'
        AND con.confrelid = $1::regclass`,
    [parentTable],
  );

  const composite = rows.find((r) => Number(r.col_count) > 1);
  if (composite) {
    throw new Error(
      `表 ${composite.child_table} 用了复合外键指向 ${parentTable}，` +
        `本脚本的单列删除语义无法覆盖，请显式处理后再运行。`,
    );
  }

  return rows.map((r) => ({
    childTable: r.child_table,
    childColumn: r.child_column,
    parentColumn: r.parent_column,
  }));
}

/**
 * 从 `table` 的一批行出发，沿外键自底向上删除（或仅统计）。
 *
 * `path` 既防自引用外键无限递归，也防菱形依赖重复下钻。
 */
export async function sweep(
  client: Client,
  table: string,
  keyColumn: string,
  keyValues: string[],
  opts: { dryRun: boolean; counts: SweepCounts; path?: string[] },
): Promise<SweepCounts> {
  const { dryRun, counts, path = [] } = opts;
  if (keyValues.length === 0) return counts;
  if (path.includes(table)) return counts;

  for (const fk of await childForeignKeys(client, table)) {
    // 子表引用的父列不一定是我们手上的那一列，此时要先把对应的父列取值捞出来
    const childKeys =
      fk.parentColumn === keyColumn
        ? keyValues
        : (
            await client.query<Record<string, string>>(
              `SELECT DISTINCT "${fk.parentColumn}" AS v
                 FROM "${table}" WHERE "${keyColumn}" = ANY($1)`,
              [keyValues],
            )
          ).rows.map((r) => String(r.v));

    await sweep(client, fk.childTable, fk.childColumn, childKeys, {
      dryRun,
      counts,
      path: [...path, table],
    });
  }

  const affected = dryRun
    ? Number(
        (
          await client.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM "${table}" WHERE "${keyColumn}" = ANY($1)`,
            [keyValues],
          )
        ).rows[0].n,
      )
    : ((
        await client.query(
          `DELETE FROM "${table}" WHERE "${keyColumn}" = ANY($1)`,
          [keyValues],
        )
      ).rowCount ?? 0);

  if (affected > 0) counts.set(table, (counts.get(table) ?? 0) + affected);
  return counts;
}

/** 生产环境一律拒绝：这三个脚本都会不可逆地删数据。 */
export function refuseInProduction(scriptName: string): void {
  if (process.env.NODE_ENV === 'production') {
    console.error(
      `✗ ${scriptName} 禁止在生产环境运行（NODE_ENV=production）。`,
    );
    process.exit(1);
  }
}

export function printCounts(counts: SweepCounts, verb: string): void {
  if (counts.size === 0) {
    console.log(`  （无数据可${verb}）`);
    return;
  }
  const width = Math.max(...[...counts.keys()].map((t) => t.length));
  let total = 0;
  for (const [table, n] of counts) {
    console.log(`  ${table.padEnd(width)}  ${String(n).padStart(6)} 行`);
    total += n;
  }
  console.log(`  ${'合计'.padEnd(width - 2)}  ${String(total).padStart(6)} 行`);
}
