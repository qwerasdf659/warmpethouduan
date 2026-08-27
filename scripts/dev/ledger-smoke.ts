/**
 * 账本与交易系统的真机冒烟。
 *
 * 与 e2e 的分工：e2e 用假 HTTP 打接口、跑完自清；本脚本**连真实运行环境**
 * （真库、真 Redis、真配置中心），把期 1~5 的关键链路各走一遍，最后跑一次
 * 全量对账。用途是发版后确认「这台机器上确实是好的」——
 * e2e 绿而线上坏的典型成因是配置、迁移版本、系统账户播种这三样，
 * 而它们只有在真实环境里才暴露。
 *
 * 默认**跑完自清**（`--keep` 可保留数据以便人工排查）。
 *
 * 用法：
 *   npm run smoke:ledger
 *   npm run smoke:ledger -- --keep
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { ReconcileService } from '../../src/economy/reconcile.service';
import { GameConfigService } from '../../src/config/game-config.service';
import { AccountService } from '../../src/ledger/account.service';
import { ExpireService } from '../../src/ledger/expire.service';
import { InventoryService } from '../../src/ledger/inventory.service';
import { LedgerService } from '../../src/ledger/ledger.service';
import { RewardService } from '../../src/ledger/reward.service';
import { GAME_COIN, MARKETING_POINT } from '../../src/ledger/ledger.types';
import { MarketService } from '../../src/market/market.service';
import { TradeService } from '../../src/trade/trade.service';

const KEEP = process.argv.includes('--keep');

let failures = 0;
const createdUserIds: string[] = [];

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`);
}

function bad(msg: string): void {
  failures += 1;
  console.log(`  ✗ ${msg}`);
}

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) ok(`${label} = ${a}`);
  else bad(`${label}：期望 ${b}，实际 ${a}`);
}

const uniq = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

async function main(): Promise<void> {
  // 关掉 Nest 的启动日志：冒烟的输出应该是一份能一眼看完的清单，
  // 而不是几百行路由注册
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const ds = app.get(DataSource);
  const ledger = app.get(LedgerService);
  const reward = app.get(RewardService);
  const inventory = app.get(InventoryService);
  const accounts = app.get(AccountService);
  const market = app.get(MarketService);
  const trade = app.get(TradeService);
  const reconcile = app.get(ReconcileService);
  const expire = app.get(ExpireService);
  const config = app.get(GameConfigService);

  /** 建一个冒烟玩家（注册时间拨到 30 天前，绕过新号交易冷却）。 */
  async function player(game = 0): Promise<string> {
    const openid = `smoke_${uniq()}`;
    const rows = await ds.query<{ id: string }[]>(
      `INSERT INTO "user" (openid, status, created_at)
       VALUES ($1, 'active', now() - interval '30 days') RETURNING id`,
      [openid],
    );
    const userId = rows[0].id;
    createdUserIds.push(userId);
    if (game > 0) {
      await reward.grant(userId, [{ assetCode: GAME_COIN, count: game }], {
        reason: 'compensation',
        bizKey: `smoke:fund:${uniq()}`,
        scope: 'sys',
      });
    }
    return userId;
  }

  /** 发一件唯一物品并把交易冷却拨到过去。 */
  async function tradableInstance(
    userId: string,
    assetCode: string,
  ): Promise<string> {
    await reward.grant(userId, [{ assetCode, count: 1 }], {
      reason: 'compensation',
      bizKey: `smoke:mint:${uniq()}`,
      scope: 'sys',
    });
    const [inst] = await inventory.listInstances(userId, assetCode);
    await ds.query(
      `UPDATE item_instance SET tradable_after = now() - interval '1 hour' WHERE id = $1`,
      [inst.instanceId],
    );
    return inst.instanceId;
  }

  const coinOf = async (userId: string) =>
    (await ledger.balances(userId))[GAME_COIN]?.available ?? 0;

  try {
    // ---------------------------------------------------------------- 环境
    console.log('\n环境');
    const mig = await ds.query<{ name: string }[]>(
      `SELECT name FROM migrations ORDER BY timestamp DESC LIMIT 1`,
    );
    ok(`最新迁移：${mig[0]?.name ?? '(无)'}`);

    const sys = await ds.query<{ system_code: string }[]>(
      `SELECT system_code FROM account WHERE system_code IS NOT NULL ORDER BY 1`,
    );
    check(
      '系统账户',
      sys.map((r) => r.system_code),
      ['ESCROW', 'FEE'],
    );

    // relkind='r' 必须带：pg_class 里同名前缀的还有每个分区的索引，
    // 不过滤会把 18 个分区数成 72（每分区 1 表 + 3 索引）
    const parts = await ds.query<{ n: string }[]>(
      `SELECT count(*) n FROM pg_class
        WHERE relname LIKE 'asset_entry_2%' AND relkind = 'r'`,
    );
    ok(`asset_entry 月度分区：${parts[0].n} 个`);

    const defs = await ds.query<{ kind: string; n: string }[]>(
      `SELECT kind, count(*) n FROM asset_def GROUP BY 1 ORDER BY 1`,
    );
    ok(`资产定义：${defs.map((d) => `${d.kind}=${d.n}`).join(' ')}`);

    // 合规红线必须在库层，不能只在文档里
    const checks = await ds.query<{ conname: string }[]>(
      `SELECT conname FROM pg_constraint
        WHERE conname IN ('ck_asset_no_trade_redeem','ck_asset_no_trade_gacha','ck_asset_mint_limit')
        ORDER BY 1`,
    );
    check('合规 CHECK 约束', checks.length, 3);

    // ---------------------------------------------------------------- 期 1
    console.log('\n期 1 · 账本核心');

    const a = await player(5000);
    check('发放后余额', await coinOf(a), 5000);

    // 多资产原子：扣币 + 发道具一张凭证
    await reward.exchange(
      a,
      [{ assetCode: GAME_COIN, count: 900 }],
      [
        { assetCode: 'furn_sofa', count: 1 },
        { assetCode: 'cons_toy', count: 2 },
      ],
      { reason: 'purchase', bizKey: `smoke:buy:${uniq()}` },
    );
    check('扣币后余额', await coinOf(a), 4100);
    check('沙发持有', await inventory.ownedQty(a, 'furn_sofa'), 1);
    check('玩具球持有', await inventory.ownedQty(a, 'cons_toy'), 2);

    // 幂等
    const idemKey = `smoke:idem:${uniq()}`;
    await reward.grant(a, [{ assetCode: GAME_COIN, count: 100 }], {
      reason: 'daily',
      bizKey: idemKey,
    });
    const replayed = await reward.grant(
      a,
      [{ assetCode: GAME_COIN, count: 100 }],
      { reason: 'daily', bizKey: idemKey },
    );
    check('重复过账被识别为回放', replayed.duplicated, true);
    check('回放后余额只加一次', await coinOf(a), 4200);

    // 余额不足整体回滚
    let rejected = false;
    try {
      await reward.charge(a, [{ assetCode: GAME_COIN, count: 999_999 }], {
        reason: 'purchase',
        bizKey: `smoke:over:${uniq()}`,
      });
    } catch {
      rejected = true;
    }
    check('余额不足被拒', rejected, true);
    check('被拒后余额未变', await coinOf(a), 4200);

    // 批次归并：永不过期的资产恒为一行
    const lots = await ds.query<{ n: string }[]>(
      `SELECT count(*) n FROM asset_lot l JOIN account ac ON ac.id = l.account_id
        WHERE ac.user_id = $1 AND l.asset_code = $2`,
      [a, GAME_COIN],
    );
    check('game_coin 批次行数（归并为 1）', Number(lots[0].n), 1);

    // 限量编号
    const limitedCode = `skin_smoke_${Date.now()}`;
    await ds.query(
      `INSERT INTO asset_def (code, kind, name, tradable, mint_limit, sort_order, meta)
       VALUES ($1, 'unique', '冒烟限量皮肤', true, 1, 9999,
               '{"itemType":"skin","slot":"body","price":1000,"priceAsset":"game_coin"}')`,
      [limitedCode],
    );
    ledger.invalidateDefCache();
    const minted = await reward.grant(
      a,
      [{ assetCode: limitedCode, count: 1 }],
      {
        reason: 'compensation',
        bizKey: `smoke:limited:${uniq()}`,
        scope: 'sys',
      },
    );
    check('限量编号', minted.minted[0].serial, 1);

    let soldOut = false;
    try {
      await reward.grant(
        await player(),
        [{ assetCode: limitedCode, count: 1 }],
        {
          reason: 'compensation',
          bizKey: `smoke:limited:${uniq()}`,
          scope: 'sys',
        },
      );
    } catch {
      soldOut = true;
    }
    check('超出限量被拒（结构性不可超发）', soldOut, true);

    // 过期作业
    await reward.grant(a, [{ assetCode: MARKETING_POINT, count: 60 }], {
      reason: 'promo',
      bizKey: `smoke:mkt:${uniq()}`,
      scope: 'sys',
    });
    const accountId = await accounts.resolve({ userId: a });
    await ds.query(
      `UPDATE asset_lot SET expires_at = now() - interval '1 day'
        WHERE account_id = $1 AND asset_code = $2`,
      [accountId, MARKETING_POINT],
    );
    const expired = await expire.run();
    ok(
      `过期作业处理 ${expired.groups} 组，销毁 ${JSON.stringify(expired.burned)}`,
    );
    check(
      '过期后营销积分归零',
      (await ledger.balances(a))[MARKETING_POINT]?.available ?? 0,
      0,
    );

    // ---------------------------------------------------------------- 期 2~5
    console.log('\n期 2~5 · 交易市场');

    // 临时开闸（跑完还原成库里原本的值）
    const restore = await openMarket(ds, config);
    try {
      // 总闸 R10：自己把闸关上再验，而不是假设「库里默认是关的」。
      // 真实环境 market.enabled 已经是 true，依赖环境默认值的断言会随配置漂移，
      // 而漂移的表现是「冒烟偶尔红一格」，比没有这项检查更消耗人。
      // 关/开都在 restore() 的保护范围内，异常退出也不会把线上配置留在关闸状态。
      await setConfig(ds, config, 'market.enabled', false);
      let gated = false;
      try {
        await market.recycle(a, { assetCode: 'cons_toy', qty: 1 }, uniq());
      } catch {
        gated = true;
      }
      check('市场总闸关闭时写操作被拒（R10）', gated, true);
      await setConfig(ds, config, 'market.enabled', true);

      // 3a 回收
      const beforeRecycle = await coinOf(a);
      const recycled = await market.recycle(
        a,
        { assetCode: 'furn_sofa', qty: 1 },
        uniq(),
      );
      check('3a 回收所得（沙发 900 × 30%）', recycled.gained, 270);
      check('3a 回收后余额', await coinOf(a), beforeRecycle + 270);

      // 3b 赠送。标的必须是可交易资产 —— 扭蛋产出的消耗品（零食/泡泡/能量饮/蛋糕）
      // 一律 tradable=false，能赠送的消耗品只有非扭蛋产出的 cons_toy
      const b = await player();
      await reward.grant(a, [{ assetCode: 'furn_lamp', count: 3 }], {
        reason: 'compensation',
        bizKey: `smoke:g:${uniq()}`,
        scope: 'sys',
      });
      await market.gift(a, b, { assetCode: 'furn_lamp', qty: 2 }, uniq());
      check('3b 赠送后接收方持有', await inventory.ownedQty(b, 'furn_lamp'), 2);
      check('3b 赠送后送出方持有', await inventory.ownedQty(a, 'furn_lamp'), 1);

      // 3c 寄售：挂单 → 成交 → 三方分账
      const seller = await player();
      const buyer = await player(3000);
      const instId = await tradableInstance(seller, 'skin_tiger');
      const listing = await market.list(
        seller,
        { instanceId: instId },
        1000,
        'fixed',
        uniq(),
      );
      check(
        '3c 挂单后卖家不再持有标的',
        await inventory.ownedQty(seller, 'skin_tiger'),
        0,
      );

      const feeAccount = await accounts.resolve({ systemCode: 'FEE' });
      const feeBefore = await balanceOf(ds, feeAccount, GAME_COIN);
      await market.buyNow(listing.id, buyer);
      check('3c 成交后买家余额（3000−1000）', await coinOf(buyer), 2000);
      check('3c 成交后卖家余额（1000−5%）', await coinOf(seller), 950);
      check(
        '3c 手续费进 FEE 账户（通胀 sink）',
        (await balanceOf(ds, feeAccount, GAME_COIN)) - feeBefore,
        50,
      );
      check(
        '3c 物品到买家手上',
        await inventory.ownedQty(buyer, 'skin_tiger'),
        1,
      );

      // 3d 竞价：出价冻结 → 被超越解冻 → 结算
      const aSeller = await player();
      const bid1 = await player(3000);
      const bid2 = await player(3000);
      const auctionInst = await tradableInstance(aSeller, 'skin_calico');
      const auction = await market.list(
        aSeller,
        { instanceId: auctionInst },
        1400,
        'auction',
        uniq(),
      );

      await market.bid(auction.id, bid1, 1500, uniq());
      const froze = (await ledger.balances(bid1))[GAME_COIN];
      check('3d 出价冻结资金', froze, { available: 1500, frozen: 1500 });

      await market.bid(auction.id, bid2, 2000, uniq());
      check('3d 被超越后全额解冻', (await ledger.balances(bid1))[GAME_COIN], {
        available: 3000,
        frozen: 0,
      });

      const settled = await market.settleAuction(auction.id);
      check('3d 结算成交', settled.sold, true);
      check(
        '3d 中标者冻结资金已付出',
        (await ledger.balances(bid2))[GAME_COIN],
        { available: 1000, frozen: 0 },
      );
      check('3d 卖家收款（2000−5%）', await coinOf(aSeller), 1900);
      check(
        '3d 物品判给中标者',
        await inventory.ownedQty(bid2, 'skin_calico'),
        1,
      );

      // 风控：不可交易资产不能流转
      let blocked = false;
      try {
        await reward.grant(a, [{ assetCode: 'cons_snack', count: 1 }], {
          reason: 'compensation',
          bizKey: `smoke:sn:${uniq()}`,
          scope: 'sys',
        });
        await market.gift(a, b, { assetCode: 'cons_snack', qty: 1 }, uniq());
      } catch {
        blocked = true;
      }
      check('扭蛋产出物不可赠送（合规红线）', blocked, true);

      // ---------------------------------------------------------------- 易货
      // 易货与市场共用 SubjectResolverService。此前易货完全不查资产目录，
      // 于是 tradable=false 的扭蛋产出可以从这条路自由转手，
      // 把 gift/listing 上的红线整条绕开。以下四项就是那条绕行路的封堵证明。
      console.log('\n期 3e · 易货（barter）');

      const t1 = await player();
      const t2 = await player();
      await reward.grant(t1, [{ assetCode: 'furn_rug', count: 1 }], {
        reason: 'compensation',
        bizKey: `smoke:bt1:${uniq()}`,
        scope: 'sys',
      });
      await reward.grant(t2, [{ assetCode: 'furn_mat', count: 1 }], {
        reason: 'compensation',
        bizKey: `smoke:bt2:${uniq()}`,
        scope: 'sys',
      });

      // 正常易货必须照常成交 —— 补校验不能把功能本身拦掉
      const barter = await trade.offer(
        t1,
        uniq(),
        t2,
        [{ assetCode: 'furn_rug', qty: 1 }],
        [{ assetCode: 'furn_mat', qty: 1 }],
        0,
        0,
      );
      await trade.respond(t2, uniq(), barter.offer.id, 'accept');
      check(
        '3e 易货成交后 t1 收到对方地垫',
        await inventory.ownedQty(t1, 'furn_mat'),
        1,
      );
      check(
        '3e 易货成交后 t2 收到对方地毯',
        await inventory.ownedQty(t2, 'furn_rug'),
        1,
      );

      // 红线一：扭蛋产出物不能作为易货标的
      await reward.grant(t1, [{ assetCode: 'cons_snack', count: 1 }], {
        reason: 'compensation',
        bizKey: `smoke:bts:${uniq()}`,
        scope: 'sys',
      });
      let barterGacha = false;
      try {
        await trade.offer(
          t1,
          uniq(),
          t2,
          [{ assetCode: 'cons_snack', qty: 1 }],
          [],
          0,
          0,
        );
      } catch {
        barterGacha = true;
      }
      check('扭蛋产出物不可易货（修复前可绕过）', barterGacha, true);

      // 红线二：货币不能当标的（否则易货就成了汇兑市场）
      let barterCurrency = false;
      try {
        await trade.offer(
          t1,
          uniq(),
          t2,
          [{ assetCode: MARKETING_POINT, qty: 1 }],
          [],
          0,
          0,
        );
      } catch {
        barterCurrency = true;
      }
      check('营销积分不可作为易货标的', barterCurrency, true);

      // 红线三：请求对方并不持有的物品，建单当场失败而不是挂满 24 小时
      let barterGhost = false;
      try {
        await trade.offer(
          t1,
          uniq(),
          t2,
          [],
          [{ assetCode: 'furn_window', qty: 1 }],
          0,
          0,
        );
      } catch {
        barterGhost = true;
      }
      check('对方未持有的标的建单即被拒', barterGhost, true);

      // 红线四：获得冷却（trade_cooldown_hours=72）内的唯一物品不可易货
      await reward.grant(t1, [{ assetCode: 'acc_bell', count: 1 }], {
        reason: 'compensation',
        bizKey: `smoke:btc:${uniq()}`,
        scope: 'sys',
      });
      const [freshInst] = await inventory.listInstances(t1, 'acc_bell');
      let barterCooldown = false;
      try {
        await trade.offer(
          t1,
          uniq(),
          t2,
          [{ instanceId: freshInst.instanceId }],
          [],
          0,
          0,
        );
      } catch {
        barterCooldown = true;
      }
      check('冷却期内唯一物品不可易货', barterCooldown, true);
    } finally {
      // 只还原配置。临时资产定义留给最后的 cleanup 删 ——
      // 它被 item_instance 外键引用着，必须等实例先删掉
      await restore();
    }

    // ---------------------------------------------------------------- 对账
    console.log('\n对账');
    const report = await reconcile.run();
    for (const inv of report.invariants) {
      if (inv.ok) ok(`#${inv.id} ${inv.name}`);
      else
        bad(
          `#${inv.id} ${inv.name}：${inv.count} 条违反 ${JSON.stringify(inv.samples.slice(0, 3))}`,
        );
    }
    for (const l of report.liabilities) {
      ok(
        `待兑付负债 ${l.assetCode}：发行 ${l.issued} − 兑付 ${l.burned} = ${l.outstanding}`,
      );
    }
  } finally {
    if (KEEP) {
      console.log(`\n--keep：保留了 ${createdUserIds.length} 个冒烟玩家`);
    } else {
      await cleanup(ds, createdUserIds);
      console.log(`\n已清理 ${createdUserIds.length} 个冒烟玩家及其账本数据`);
    }
    await app.close();
  }

  console.log(
    failures === 0
      ? '\n冒烟通过：账本与交易系统在本机运行正常\n'
      : `\n冒烟失败：${failures} 项不通过\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

/** 写一个配置项并立刻失效缓存（仅冒烟内部用）。 */
async function setConfig(
  ds: DataSource,
  config: GameConfigService,
  key: string,
  value: unknown,
): Promise<void> {
  await ds.query(
    `INSERT INTO game_config (key, description, value) VALUES ($1, '冒烟临时覆盖', $2)
     ON CONFLICT (key) DO UPDATE SET value = $2`,
    [key, JSON.stringify(value)],
  );
  config.invalidate();
}

/** 临时全档开闸，返回还原函数。 */
async function openMarket(
  ds: DataSource,
  config: GameConfigService,
): Promise<() => Promise<void>> {
  const overrides: Record<string, unknown> = {
    'market.enabled': true,
    'market.features': {
      recycle: true,
      gift: true,
      listing: true,
      auction: true,
      trade: true,
    },
    // 冒烟不测风控阈值本身（那是 e2e 的事），这里放宽以免额度把链路打断
    'market.risk': {
      minAccountAgeDays: 0,
      maxTradesPerDay: 100,
      maxValuePerDay: 100_000_000,
      abnormalPriceRatio: 5,
    },
  };
  const before = new Map<string, unknown>();
  for (const [key, value] of Object.entries(overrides)) {
    const rows = await ds.query<{ value: unknown }[]>(
      `SELECT value FROM game_config WHERE key = $1`,
      [key],
    );
    before.set(key, rows.length ? rows[0].value : undefined);
    await setConfig(ds, config, key, value);
  }

  return async () => {
    for (const [key, original] of before) {
      if (original === undefined) {
        await ds.query(`DELETE FROM game_config WHERE key = $1`, [key]);
      } else {
        await ds.query(`UPDATE game_config SET value = $2 WHERE key = $1`, [
          key,
          JSON.stringify(original),
        ]);
      }
    }
    config.invalidate();
  };
}

async function balanceOf(
  ds: DataSource,
  accountId: string,
  assetCode: string,
): Promise<number> {
  const rows = await ds.query<{ available: string }[]>(
    `SELECT available FROM asset_balance WHERE account_id = $1 AND asset_code = $2`,
    [accountId, assetCode],
  );
  return Number(rows[0]?.available ?? 0);
}

/**
 * 清理冒烟数据。顺序即外键拓扑序；系统账户上的残留（FEE 手续费、
 * ESCROW 托管中的实例）也要一并清掉，否则每跑一次都往里积一批。
 */
async function cleanup(ds: DataSource, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const accs = (
    await ds.query<{ id: string }[]>(
      `SELECT id FROM account WHERE user_id = ANY($1::bigint[])`,
      [userIds],
    )
  ).map((r) => r.id);
  const sys = (
    await ds.query<{ id: string }[]>(
      `SELECT id FROM account WHERE system_code IS NOT NULL`,
    )
  ).map((r) => r.id);
  const all = [...accs, ...sys];

  // 易货单据先于用户删：trade_offer_item 挂在 offer 上，offer 挂在双方 user 上
  await ds.query(
    `DELETE FROM trade_offer_item WHERE offer_id IN (
       SELECT id FROM trade_offer
        WHERE from_user_id = ANY($1::bigint[]) OR to_user_id = ANY($1::bigint[]))`,
    [userIds],
  );
  await ds.query(
    `DELETE FROM trade_offer
      WHERE from_user_id = ANY($1::bigint[]) OR to_user_id = ANY($1::bigint[])`,
    [userIds],
  );

  for (const table of [
    'promo_redemption',
    'gacha_draw',
    'gacha_state',
    'redeem_order',
    'user_address',
    'dex_claim',
    'home_layout',
    'pet_equip',
    'race_record',
    'daily',
    'pet',
  ]) {
    await ds.query(`DELETE FROM ${table} WHERE user_id = ANY($1::bigint[])`, [
      userIds,
    ]);
  }
  if (all.length > 0) {
    await ds.query(
      `DELETE FROM market_bid WHERE bidder_account_id = ANY($1::bigint[])
         OR listing_id IN (SELECT id FROM market_listing WHERE seller_account_id = ANY($1::bigint[]))`,
      [all],
    );
    await ds.query(
      `DELETE FROM market_listing WHERE seller_account_id = ANY($1::bigint[])`,
      [all],
    );
    await ds.query(
      `DELETE FROM item_instance_entry WHERE account_id = ANY($1::bigint[])
         OR instance_id IN (SELECT id FROM item_instance WHERE owner_account_id = ANY($1::bigint[]))`,
      [all],
    );
    await ds.query(
      `DELETE FROM item_instance WHERE owner_account_id = ANY($1::bigint[])`,
      [all],
    );
    for (const table of [
      'asset_entry',
      'asset_lot',
      'asset_balance',
      'trade_risk_daily',
    ]) {
      await ds.query(
        `DELETE FROM ${table} WHERE account_id = ANY($1::bigint[])`,
        [all],
      );
    }
  }
  if (accs.length > 0) {
    await ds.query(`DELETE FROM account WHERE id = ANY($1::bigint[])`, [accs]);
  }
  await ds.query(`DELETE FROM "user" WHERE id = ANY($1::bigint[])`, [userIds]);

  // 临时资产定义要等它的实例都删完才能删（item_instance_asset_code_fkey）。
  // 这正是 `AdminItemsService.remove` 拒绝删除「已有持有记录的资产」的同一条约束。
  await ds.query(`DELETE FROM asset_def WHERE code LIKE 'skin_smoke_%'`);

  // 孤儿凭证头（reversal_of 自引用，多扫几轮）
  for (let round = 0; round < 3; round += 1) {
    const deleted = await ds.query<{ id: string }[]>(
      `DELETE FROM asset_txn t
        WHERE NOT EXISTS (SELECT 1 FROM asset_entry e WHERE e.txn_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM item_instance i WHERE i.minted_txn_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM item_instance_entry ie WHERE ie.txn_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM market_listing l
                           WHERE l.created_txn_id = t.id OR l.settled_txn_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM market_bid b WHERE b.freeze_txn_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM asset_txn r WHERE r.reversal_of = t.id)
        RETURNING t.id`,
    );
    if (deleted.length === 0) break;
  }
}

void main().catch((err: unknown) => {
  console.error('\n冒烟脚本异常：', err);
  process.exit(1);
});
