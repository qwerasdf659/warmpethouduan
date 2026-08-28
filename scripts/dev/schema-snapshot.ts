/**
 * 导出当前库的 schema 指纹（只读）。
 *
 * 用途是**压平迁移前后的比对基准**：迁移压平的风险不在写错语法（那会当场报错），
 * 而在静默漏掉一样东西——`asset_entry` 的月度分区、`asset_lot` 的
 * `NULLS NOT DISTINCT` 唯一索引、几条多列 CHECK，这些都是 `migration:generate`
 * 表达不出来的，漏了不会报错，只会在某天以「唯一约束没生效」的形式暴露。
 *
 * 因此这里抓的是**权威来源**（pg_catalog），而不是从实体推导。
 *
 * 用法：
 *   npm run schema:snapshot            # 打到标准输出
 *   npm run schema:snapshot -- --save  # 写到 /tmp/schema-before.json
 */
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { makeClient } from './_db';

interface Snapshot {
  tables: { name: string; kind: string; partitioned: boolean }[];
  columns: string[];
  constraints: string[];
  indexes: string[];
  partitions: string[];
  sequences: string[];
}

/**
 * 只看本项目自己的对象。
 *
 * Sealos 托管库的 public 里混着 `pg_stat_*` / `failed_authentication_*` 视图与
 * `postgres_log_*` 外部表，它们不属于本项目、也不该进比对基准。
 * 判据与 `audit-state.ts` 的表巡检一致：普通表/分区父表，且不是传统继承体系。
 */
const OURS = `
  c.relkind IN ('r','p','S')
  AND NOT EXISTS (
    SELECT 1 FROM pg_inherits i
      JOIN pg_class ch ON ch.oid = i.inhrelid
     WHERE i.inhparent = c.oid AND NOT ch.relispartition
  )
`;

async function main(): Promise<void> {
  const client = makeClient();
  await client.connect();
  try {
    const tables = (
      await client.query<{ name: string; kind: string; partitioned: boolean }>(
        `SELECT c.relname AS name, c.relkind AS kind,
                (c.relkind = 'p') AS partitioned
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
            AND NOT c.relispartition AND ${OURS}
          ORDER BY 1`,
      )
    ).rows;

    const columns = (
      await client.query<{ sig: string }>(
        `SELECT format('%s.%s %s%s%s',
                  c.table_name, c.column_name, c.data_type,
                  COALESCE('(' || c.character_maximum_length || ')', ''),
                  CASE WHEN c.is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END
                ) AS sig
           FROM information_schema.columns c
           JOIN pg_class pc ON pc.relname = c.table_name
           JOIN pg_namespace pn ON pn.oid = pc.relnamespace AND pn.nspname = 'public'
          WHERE c.table_schema = 'public' AND NOT pc.relispartition
          ORDER BY 1`,
      )
    ).rows.map((r) => r.sig);

    const constraints = (
      await client.query<{ sig: string }>(
        `SELECT format('%s: %s %s', c.relname, con.conname,
                       pg_get_constraintdef(con.oid)) AS sig
           FROM pg_constraint con
           JOIN pg_class c ON c.oid = con.conrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND NOT c.relispartition
          ORDER BY 1`,
      )
    ).rows.map((r) => r.sig);

    const indexes = (
      await client.query<{ sig: string }>(
        `SELECT indexdef AS sig FROM pg_indexes
          WHERE schemaname = 'public' AND tablename NOT LIKE 'asset_entry_%'
          ORDER BY 1`,
      )
    ).rows.map((r) => r.sig);

    // 分区边界：漏掉一个月份不会报错，只会让那个月的分录落进 default 分区
    const partitions = (
      await client.query<{ sig: string }>(
        `SELECT format('%s -> %s %s', parent.relname, child.relname,
                       pg_get_expr(child.relpartbound, child.oid)) AS sig
           FROM pg_inherits i
           JOIN pg_class child ON child.oid = i.inhrelid
           JOIN pg_class parent ON parent.oid = i.inhparent
           JOIN pg_namespace n ON n.oid = parent.relnamespace
          WHERE n.nspname = 'public' AND child.relispartition
          ORDER BY 1`,
      )
    ).rows.map((r) => r.sig);

    const sequences = (
      await client.query<{ sig: string }>(
        `SELECT sequence_name AS sig FROM information_schema.sequences
          WHERE sequence_schema = 'public' ORDER BY 1`,
      )
    ).rows.map((r) => r.sig);

    const snap: Snapshot = {
      tables,
      columns,
      constraints,
      indexes,
      partitions,
      sequences,
    };

    const json = JSON.stringify(snap, null, 2);
    if (process.argv.includes('--save')) {
      writeFileSync('/tmp/schema-before.json', json);
      console.log('已写入 /tmp/schema-before.json');
    } else {
      console.log(json);
    }
    console.log(
      `\n统计：表 ${tables.length} / 列 ${columns.length} / 约束 ${constraints.length} / 索引 ${indexes.length} / 分区 ${partitions.length} / 序列 ${sequences.length}`,
    );
  } finally {
    await client.end();
  }
}

void main();
