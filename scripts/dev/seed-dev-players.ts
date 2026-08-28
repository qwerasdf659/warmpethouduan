/**
 * 造联调用测试玩家（幂等）。
 *
 *   npm run seed:dev
 *
 * 造出的账号与 `WECHAT_MOCK_LOGIN` 假登录同源：种子里的 tag = 登录 code 的 tag，
 * 所以 `npm run seed:dev` 之后直接用 `mock:mid` 登录，拿到的就是这个带进度的号。
 *
 * 走 NestJS 应用上下文复用真实 service，而不是裸插 SQL：发币必须经 EconomyService
 * 才会同时落 wallet 和 ledger，手写 INSERT 很容易造出「余额有、流水无」的账，
 * 那种数据拿去测对账/流水页只会得出错误结论。
 *
 * 幂等靠两处：账号按 openid 唯一索引 upsert；发币用**稳定 bizId**，
 * 重复运行会命中 (userId,bizId,pool) 唯一索引走幂等回放，不会翻倍发钱。
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { GAME_COIN, MARKETING_POINT } from '../../src/ledger/ledger.types';
import { AppModule } from '../../src/app.module';
import { ClockService } from '../../src/common/clock/clock.service';
import { GameConfigService } from '../../src/config/game-config.service';
import { EconomyService } from '../../src/economy/economy.service';
import { Pet } from '../../src/entities/pet.entity';
import { User } from '../../src/entities/user.entity';
import { MOCK_OPENID_PREFIX } from '../../src/wechat/wechat.service';
import type { PetAttrs, PetGrowth } from '../../src/pet/pet.config';
import { refuseInProduction } from './_db';

interface Profile {
  /** 假登录 tag，登录用 `mock:<tag>` */
  tag: string;
  nickname: string;
  /** 目标等级，脚本按成长曲线反推所需累计 exp */
  level: number;
  gameCoin: number;
  marketingPoint: number;
  purpose: string;
}

/**
 * 三档进度覆盖不同的测试面：新号验新手引导与首次互动，中期号有钱可测消费出口，
 * 后期号攒够营销积分才能测兑换实物与履约。
 */
const PROFILES: Profile[] = [
  {
    tag: 'newbie',
    nickname: '新手蛋',
    level: 1,
    gameCoin: 0,
    marketingPoint: 0,
    purpose: '新手引导 / 首次互动 / 空钱包边界',
  },
  {
    tag: 'mid',
    nickname: '中期崽',
    level: 8,
    gameCoin: 5_000,
    marketingPoint: 200,
    purpose: '换装 / 家园 / 赛跑 / 签到连击',
  },
  {
    tag: 'veteran',
    nickname: '毕业狗',
    level: 30,
    gameCoin: 50_000,
    marketingPoint: 5_000,
    purpose: '兑换实物 / 履约 / 图鉴 / 高等级属性',
  },
];

/** 成长曲线的逆运算：升到 `level` 级所需的累计 exp。 */
function cumulativeExpFor(level: number, growth: PetGrowth): number {
  let total = 0;
  let need = growth.baseExp;
  for (let lv = 1; lv < Math.min(level, growth.maxLevel); lv++) {
    total += need;
    need = Math.round(need * growth.ratio);
  }
  return total;
}

function staminaMaxOf(level: number, attrs: PetAttrs): number {
  return attrs.staminaMaxBase + attrs.staminaMaxPerLevel * (level - 1);
}

async function main(): Promise<void> {
  refuseInProduction('seed:dev');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const ds = app.get(DataSource);
  const clock = app.get(ClockService);
  const economy = app.get(EconomyService);
  const config = app.get(GameConfigService);

  const users = ds.getRepository(User);
  const pets = ds.getRepository(Pet);
  const growth = await config.get('pet.growth');
  const attrs = await config.get('pet.attrs');
  const now = clock.now();

  console.log(`\n播种测试玩家（DB=${process.env.DB_NAME}）\n`);

  for (const p of PROFILES) {
    const openid = `${MOCK_OPENID_PREFIX}${p.tag}`;

    // upsert：已存在则复用，保证反复播种指向同一个号
    await users.upsert(
      { openid, status: 'active', lastSeenAt: now, offlineBaseAt: now },
      { conflictPaths: ['openid'], skipUpdateIfNoValuesChanged: true },
    );
    const user = await users.findOneOrFail({ where: { openid } });

    const exp = cumulativeExpFor(p.level, growth);
    const staminaMax = staminaMaxOf(p.level, attrs);

    // 属性是懒结算的，这里把 last_seen_at 设为 now，避免刚播完种就被判定衰减了很久
    let pet = await pets.findOne({
      where: { userId: user.id, isActive: true },
    });
    if (!pet) {
      pet = pets.create({ userId: user.id, isActive: true });
    }
    pet.nickname = p.nickname;
    pet.species = 'default';
    pet.hunger = 90;
    pet.mood = 90;
    pet.cleanliness = 90;
    pet.stamina = staminaMax;
    pet.intimacy = p.level * 50;
    pet.level = p.level;
    pet.exp = exp;
    pet.lastSeenAt = now;
    await pets.save(pet);

    const granted: string[] = [];
    for (const [pool, amount] of [
      ['game', p.gameCoin],
      ['marketing', p.marketingPoint],
    ] as const) {
      if (amount <= 0) continue;
      const res = await economy.apply({
        userId: user.id,
        assetCode: pool === 'game' ? GAME_COIN : MARKETING_POINT,
        delta: amount,
        // 稳定 bizId：含 tag 与金额，改了额度会重新发一笔，没改则回放不重复发
        bizId: `seed:${p.tag}:${pool}:${amount}`,
        reason: 'admin_grant',
      });
      granted.push(
        `${pool}=${res.wallet[pool === 'game' ? 'gameCoin' : 'marketingPoint']}` +
          (res.duplicated ? '(回放)' : ''),
      );
    }

    console.log(
      `  ✓ mock:${p.tag.padEnd(8)} userId=${String(user.id).padStart(4)} ` +
        `Lv${String(p.level).padStart(2)} exp=${String(exp).padStart(7)} ` +
        `${granted.join(' ') || '钱包空'}`,
    );
    console.log(`      用途：${p.purpose}`);
  }

  console.log(
    `\n登录方式：POST /auth/login  { "code": "mock:mid" }` +
      `（需 WECHAT_MOCK_LOGIN=true）\n` +
      `清理方式：npm run clean:dev\n`,
  );

  await app.close();
  // Redis/连接池会留着句柄不让进程自然退出，显式收尾
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('✗ 播种失败：', err instanceof Error ? err.message : err);
  process.exit(1);
});
