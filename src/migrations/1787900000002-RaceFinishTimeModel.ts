import { MigrationInterface, QueryRunner } from 'typeorm';

interface StoredTrack {
  key: string;
  distance: number;
  recommendLevel: number;
  targetTime?: number;
  [k: string]: unknown;
}

/**
 * 赛跑判定由「战力算分排名次」改为**完赛时间模型**。
 *
 * 建三列：`finish_time`（判定核心量，名次与评级都由它派生）、`grade`（S/A/B/C）、
 * `ghost_source`（影子来源，排查「对手怎么这么快」用）。三列都可空——存量记录
 * 是战力模型时期产生的，没有完赛时间，**不做回填**：按旧公式硬凑一个时间出来，
 * 会污染影子采样池（采到的是编造的数据），也会让历史评级失去意义。
 * 采样与展示都按 `finish_time IS NOT NULL` 过滤。
 *
 * 同时补 `race.tracks` 的 `targetTime`（评级基准时间，schema 里 required），
 * 并写入三条新配置行。新 key 若不落行，后台配置页看不到它们
 *（`AdminConfigService.list()` 只列 DB 行），运营就没法热改。
 */
export class RaceFinishTimeModel1787900000002 implements MigrationInterface {
  name = 'RaceFinishTimeModel1787900000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "race_record" ADD "finish_time" numeric(10,3)`,
    );
    await queryRunner.query(
      `ALTER TABLE "race_record" ADD "grade" character varying(2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "race_record" ADD "ghost_source" character varying(8)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_race_ghost_sample" ON "race_record" ("track_key", "pet_level", "created_at")`,
    );

    // 存量赛道补评级基准时间：按建议等级 + 满心情的期望耗时估算
    const rows = (await queryRunner.query(
      `SELECT value FROM game_config WHERE key = 'race.tracks'`,
    )) as { value: StoredTrack[] }[];
    if (rows.length) {
      const patched = rows[0].value.map((t) => ({
        ...t,
        targetTime: t.targetTime ?? estimateTargetTime(t),
      }));
      await queryRunner.query(
        `UPDATE game_config SET value = $1, updated_at = now() WHERE key = 'race.tracks'`,
        [JSON.stringify(patched)],
      );
    }

    await insertConfig(
      queryRunner,
      'race.formula',
      '完赛时间公式：配速常数、心情权重、耐力基准、后程掉速与扰动',
      {
        paceConstant: 2,
        moodBase: 0.8,
        moodSpan: 0.2,
        enduranceBase: 40,
        fadeFactor: 0.05,
        jitter: 0.05,
      },
    );
    await insertConfig(
      queryRunner,
      'race.grade_thresholds',
      '评级阈值（finishTime / track.targetTime 的上界），超 B 即 C',
      { S: 0.9, A: 1.0, B: 1.15 },
    );
    await insertConfig(
      queryRunner,
      'race.ghost',
      '影子对手：是否采样真实玩家成绩、等级带、回溯期与异常值钳制',
      {
        enabled: true,
        levelBand: 3,
        lookbackDays: 30,
        minSamples: 2,
        clampMin: 0.7,
        clampMax: 1.6,
      },
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM game_config WHERE key IN ('race.formula', 'race.grade_thresholds', 'race.ghost')`,
    );

    const rows = (await queryRunner.query(
      `SELECT value FROM game_config WHERE key = 'race.tracks'`,
    )) as { value: StoredTrack[] }[];
    if (rows.length) {
      const stripped = rows[0].value.map((t) => {
        const { targetTime: _t, ...rest } = t;
        return rest;
      });
      await queryRunner.query(
        `UPDATE game_config SET value = $1, updated_at = now() WHERE key = 'race.tracks'`,
        [JSON.stringify(stripped)],
      );
    }

    await queryRunner.query(`DROP INDEX "idx_race_ghost_sample"`);
    await queryRunner.query(
      `ALTER TABLE "race_record" DROP COLUMN "ghost_source"`,
    );
    await queryRunner.query(`ALTER TABLE "race_record" DROP COLUMN "grade"`);
    await queryRunner.query(
      `ALTER TABLE "race_record" DROP COLUMN "finish_time"`,
    );
  }
}

/**
 * 用默认公式反推赛道基准时间，使「建议等级 + 满心情」正好落在 A 档附近。
 * 与 `baseFinishTime()` 同一套算式，参数取默认值——迁移不能 import 运行时配置，
 * 否则以后改了默认值，这条已执行过的迁移的语义就跟着漂了。
 */
function estimateTargetTime(track: StoredTrack): number {
  const level = Math.max(1, track.recommendLevel ?? 1);
  const speed = 10 + 1.0 * (level - 1);
  const endurance = 10 + 0.8 * (level - 1);
  const basePace = 2 / speed;
  const gap = Math.max(0, 1 - endurance / 40);
  const distance = track.distance ?? 100;
  // 上取整：向下取整会让达标玩家的比值略微超过 1.0 而掉到 B 档
  return Math.ceil(distance * basePace + gap * distance * 0.05);
}

async function insertConfig(
  queryRunner: QueryRunner,
  key: string,
  description: string,
  value: unknown,
): Promise<void> {
  await queryRunner.query(
    `INSERT INTO game_config (key, description, value)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (key) DO NOTHING`,
    [key, description, JSON.stringify(value)],
  );
}
