import { MigrationInterface, QueryRunner } from 'typeorm';

interface StoredTask {
  key: string;
  [k: string]: unknown;
}

const RACE_TASK: StoredTask = {
  key: 'race',
  name: '完成 1 场赛跑',
  target: 1,
  coin: 25,
  source: 'race',
};

/**
 * 补「完成赛跑」每日任务。
 *
 * 此前任务只有 checkin/interact/play 三个，赛跑这个招牌玩法没有任何日常牵引，
 * 而规格里的任务示例本就包含赛跑。进度打点在 `RaceService.settle`
 *（只在状态真正从 pending 流转到 settled 时 +1，重复结算刷不出进度）。
 */
export class DailyRaceTask1787900000005 implements MigrationInterface {
  name = 'DailyRaceTask1787900000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(
      `SELECT value FROM game_config WHERE key = 'daily.tasks'`,
    )) as { value: StoredTask[] }[];
    if (!rows.length) return;
    if (rows[0].value.some((t) => t.key === RACE_TASK.key)) return;

    await queryRunner.query(
      `UPDATE game_config SET value = $1, description = $2, updated_at = now() WHERE key = 'daily.tasks'`,
      [
        JSON.stringify([...rows[0].value, RACE_TASK]),
        '每日任务列表：进度来源限 act(互动次数)/play(陪玩)/checkin(签到)/race(赛跑场数)',
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(
      `SELECT value FROM game_config WHERE key = 'daily.tasks'`,
    )) as { value: StoredTask[] }[];
    if (!rows.length) return;

    await queryRunner.query(
      `UPDATE game_config SET value = $1, updated_at = now() WHERE key = 'daily.tasks'`,
      [JSON.stringify(rows[0].value.filter((t) => t.key !== RACE_TASK.key))],
    );
  }
}
