/**
 * B5-2 / B5-3 实测：完赛时间判定 + 影子对手采样真实玩家成绩。
 *
 * 验五件事：
 *   A. 库里没有同赛道成绩时，影子来源为 npc（兜底生效）；
 *   B. 灌入同等级带的真实成绩后，影子来源变成 player，且对手时间就是那批成绩；
 *   C. 等级带外的成绩不会被采到（不会拿满级号的成绩去压新手）；
 *   D. 极端成绩（刷榜/改档）被钳进合理区间，不会让玩家必然垫底；
 *   E. 心情低的宠完赛更慢（mood 真的进了判定）。
 *
 * 用法：npm run build && node scripts/b5-verify-race-ghost.js
 */
const P = '/home/devbox/project/node_modules/';
require(P + 'dotenv').config({ path: '/home/devbox/project/.env' });
const { Client } = require(P + 'pg');
const { NestFactory } = require(P + '@nestjs/core');

function db() {
  return new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
}

let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
}

const TRACK = 'meadow';
const userIds = [];

async function makeUser(c, tag) {
  const id = (
    await c.query(
      `insert into "user" (openid, status) values ($1,'active') returning id`,
      [
        `b5_ghost_${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ],
    )
  ).rows[0].id;
  userIds.push(id);
  return id;
}

async function makePet(c, userId, level, mood) {
  return (
    await c.query(
      `insert into pet (user_id, is_active, hunger, cleanliness, mood, stamina, intimacy, level, exp, last_seen_at)
       values ($1, true, 80, 80, $2, 100, 0, $3, 0, now()) returning id`,
      [userId, mood, level],
    )
  ).rows[0].id;
}

/** 直接灌一条已结算的赛跑成绩，作为可被采样的影子。 */
async function seedRecord(c, userId, petId, level, finishTime) {
  await c.query(
    `insert into race_record
       (user_id, pet_id, track_key, pet_level, score, finish_time, grade, ghost_source,
        rank, total_racers, reward_coin, stamina_cost, status, settled_at)
     values ($1,$2,$3,$4,30,$5,'A','npc',1,4,50,20,'settled',now())`,
    [userId, petId, TRACK, level, finishTime],
  );
}

async function main() {
  const { AppModule } = require('/home/devbox/project/dist/app.module');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const {
    RaceService,
  } = require('/home/devbox/project/dist/race/race.service');
  const race = app.get(RaceService);

  const c = db();
  await c.connect();

  try {
    // 等级是按 exp 派生的，pet.level 那一列不作数：影子采样按**派生等级**分带，
    // 所以灌样本前必须先问一遍服务端「这只宠现在算几级」，否则样本全落在带外。
    const probe = await makeUser(c, 'probe');
    await makePet(c, probe, 1, 100);
    const LEVEL = (await race.listTracks(probe)).battle.level;
    console.log(`· 派生等级 = ${LEVEL}（影子等级带以此为中心）`);

    // -------------------------------------------------------- A. NPC 兜底
    const solo = await makeUser(c, 'solo');
    await makePet(c, solo, LEVEL, 100);
    const r1 = await race.start(solo, TRACK, `ghost-a-${Date.now()}`);
    check('无可采样成绩时退回 NPC', r1.ghostSource === 'npc', r1.ghostSource);
    check(
      '产出完赛时间与评级',
      r1.finishTime > 0 && !!r1.grade,
      `${r1.finishTime}s ${r1.grade}`,
    );
    check(
      '名次与完赛时间自洽',
      r1.rank ===
        1 + r1.opponentFinishTimes.filter((t) => t < r1.finishTime).length,
    );

    // ------------------------------------------------- B. 采到真实玩家成绩
    const ghosts = [];
    for (let i = 0; i < 3; i++) {
      const u = await makeUser(c, `ghost${i}`);
      const p = await makePet(c, u, LEVEL, 100);
      // 略慢于玩家基准，确保玩家能赢，同时时间值好识别
      await seedRecord(c, u, p, LEVEL, r1.finishTime + 1 + i);
      ghosts.push(r1.finishTime + 1 + i);
    }

    const hunter = await makeUser(c, 'hunter');
    await makePet(c, hunter, LEVEL, 100);
    const r2 = await race.start(hunter, TRACK, `ghost-b-${Date.now()}`);
    check(
      '有足够真实成绩时采真人影子',
      r2.ghostSource === 'player',
      r2.ghostSource,
    );
    const sampledFromSeed = r2.opponentFinishTimes.every((t) =>
      ghosts.some((g) => Math.abs(g - t) < 0.01),
    );
    check(
      '对手时间来自灌入的真实成绩',
      sampledFromSeed,
      JSON.stringify(r2.opponentFinishTimes),
    );

    // --------------------------------------------- C. 等级带外的成绩不采
    const farUser = await makeUser(c, 'far');
    const farPet = await makePet(c, farUser, LEVEL, 100);
    await seedRecord(c, farUser, farPet, LEVEL + 40, 0.5);
    const r3 = await race.start(hunter, TRACK, `ghost-c-${Date.now()}`);
    check(
      '等级带外的极快成绩没被采进来',
      r3.opponentFinishTimes.every((t) => t > 1),
      JSON.stringify(r3.opponentFinishTimes),
    );

    // ------------------------------------------------- D. 异常值被钳制
    await c.query(
      `delete from race_record where track_key = $1 and pet_level = $2`,
      [TRACK, LEVEL],
    );
    for (let i = 0; i < 3; i++) {
      const u = await makeUser(c, `cheat${i}`);
      const p = await makePet(c, u, LEVEL, 100);
      await seedRecord(c, u, p, LEVEL, 0.001);
    }
    const r4 = await race.start(hunter, TRACK, `ghost-d-${Date.now()}`);
    check(
      '刷榜级异常成绩被钳进合理区间',
      r4.opponentFinishTimes.every((t) => t > 1),
      JSON.stringify(r4.opponentFinishTimes),
    );

    // ------------------------------------------------------ E. mood 参与
    const sad = await makeUser(c, 'sad');
    await makePet(c, sad, LEVEL, 0);
    const happy = await makeUser(c, 'happy');
    await makePet(c, happy, LEVEL, 100);
    const rSad = await race.start(sad, TRACK, `ghost-e1-${Date.now()}`);
    const rHappy = await race.start(happy, TRACK, `ghost-e2-${Date.now()}`);
    check(
      '心情低的宠完赛更慢',
      rSad.finishTime > rHappy.finishTime,
      `sad=${rSad.finishTime}s happy=${rHappy.finishTime}s`,
    );
  } catch (e) {
    failures++;
    console.log('✗ 脚本异常中断：', e.message);
  } finally {
    for (const id of userIds) {
      for (const t of ['race_record', 'ledger', 'wallet', 'pet']) {
        await c.query(`delete from ${t} where user_id = $1`, [id]);
      }
      await c.query(`delete from "user" where id = $1`, [id]);
    }
    await c.end();
    await app.close();
    console.log(failures ? `\n${failures} 项未通过` : '\n全部通过');
    process.exit(failures ? 1 : 0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
