/**
 * `scripts/*-verify-*.js` 的共用夹具。
 *
 * 存在的理由：这 7 个回归脚本原本各自用裸 SQL 造钱包（`insert into wallet …`）
 * 和清理（`delete from ledger/wallet/item_owned`）。账本重构把那四张表删了之后
 * 它们**全部失效**，而且因为是纯 `.js`、不在 `npm run lint` / `tsc` 的检查范围内
 * （那两道卡口只看 `src test scripts/dev`），坏了也不会有人知道 ——
 * 直到某天有人照文档去跑，发现「写在清单里但跑不起来」。
 *
 * 收敛到这里之后：
 *  - **造余额一律走真实记账入口**（`RewardService.grant`）。新模型的余额是
 *    `asset_lot` 的聚合缓存，手写 INSERT 只改 `asset_balance` 会让批次、分录、
 *    余额三层立刻不一致，对账的不变量 2/3/9 会把脚本自己造的数据报成异常。
 *  - 清理是账本感知的：账本表不直接引用 `user`，而是经 `account` 中转，
 *    按 `user_id` 一把删删不掉；凭证头（`asset_txn`）是父表，还要单独扫孤儿。
 *
 * 这些脚本都 require `dist/`，所以跑之前要先 `npm run build`。
 */
const P = '/home/devbox/project/node_modules/';
require(P + 'dotenv').config({ path: '/home/devbox/project/.env' });
const { Client } = require(P + 'pg');
const { NestFactory } = require(P + '@nestjs/core');
const Redis = require(P + 'ioredis');

const DIST = '/home/devbox/project/dist/';

const { GAME_COIN, MARKETING_POINT } = require(DIST + 'ledger/ledger.types');

/** 直连 pg（脚本里造业务单据、读断言用）。 */
function db() {
  return new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
}

/** 启动 Nest 应用上下文（只报错误与告警，免得几百行路由注册盖住断言输出）。 */
async function bootApp() {
  const { AppModule } = require(DIST + 'app.module');
  return NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
}

/** 从上下文里取账本域的几个 service。 */
function services(app) {
  const { RewardService } = require(DIST + 'ledger/reward.service');
  const { LedgerService } = require(DIST + 'ledger/ledger.service');
  const { InventoryService } = require(DIST + 'ledger/inventory.service');
  const { AccountService } = require(DIST + 'ledger/account.service');
  return {
    reward: app.get(RewardService),
    ledger: app.get(LedgerService),
    inventory: app.get(InventoryService),
    accounts: app.get(AccountService),
  };
}

let fundSeq = 0;

/**
 * 给玩家发放资产。走 `RewardService.grant`，因此余额、批次、分录三层一致。
 *
 * 每次调用一个新的幂等键：同一个脚本里可能连续加两次钱，共用键会命中回放。
 */
async function fundAsset(app, userId, assetCode, count) {
  if (count <= 0) return;
  const { reward } = services(app);
  await reward.grant(userId, [{ assetCode, count }], {
    reason: 'compensation',
    bizKey: `verify:fund:${userId}:${(fundSeq += 1)}`,
    scope: 'sys',
  });
}

/**
 * 把余额**设置**为指定值（而不是累加）。
 *
 * 脚本里常见「重置成刚好够买 1 件」的需求。差额同样经记账入口补/扣，
 * 不直接 UPDATE 余额 —— 理由见本文件顶部注释。
 */
async function setAsset(app, userId, assetCode, target) {
  const { reward, ledger } = services(app);
  const current = (await ledger.balances(userId))[assetCode]?.available ?? 0;
  const diff = target - current;
  if (diff === 0) return;
  const key = `verify:set:${userId}:${(fundSeq += 1)}`;
  if (diff > 0) {
    await reward.grant(userId, [{ assetCode, count: diff }], {
      reason: 'compensation',
      bizKey: key,
      scope: 'sys',
    });
  } else {
    await reward.charge(userId, [{ assetCode, count: -diff }], {
      reason: 'admin_deduct',
      bizKey: key,
      scope: 'sys',
    });
  }
}

/** 可用余额。 */
async function balanceOf(app, userId, assetCode) {
  const { ledger } = services(app);
  return (await ledger.balances(userId))[assetCode]?.available ?? 0;
}

/** 持有件数（唯一物品按实例条数，可堆叠按可用余额）。 */
async function ownedQty(app, userId, assetCode) {
  const { inventory } = services(app);
  return inventory.ownedQty(userId, assetCode);
}

/** 玩家的分录条数（可选按资产筛）。账本表经 account 挂到玩家身上。 */
async function entryCount(c, userId, assetCode) {
  const params = [userId];
  let where = 'a.user_id = $1';
  if (assetCode) {
    params.push(assetCode);
    where += ' AND e.asset_code = $2';
  }
  const r = await c.query(
    `SELECT count(*)::int n FROM asset_entry e
       JOIN account a ON a.id = e.account_id
      WHERE ${where}`,
    params,
  );
  return r.rows[0].n;
}

/**
 * 清掉一个临时玩家的全部数据（含账本）。
 *
 * 顺序即外键拓扑序。账本表不直接引用 `user`，所以先把玩家的 `account` 找出来，
 * 再按 account 删它名下的分录/批次/余额/实例/挂单。
 */
async function cleanupUser(c, userId) {
  const accs = (
    await c.query(`SELECT id FROM account WHERE user_id = $1`, [userId])
  ).rows.map((r) => r.id);

  for (const t of [
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
    await c.query(`DELETE FROM ${t} WHERE user_id = $1`, [userId]);
  }

  if (accs.length > 0) {
    await c.query(
      `DELETE FROM market_bid WHERE bidder_account_id = ANY($1::bigint[])
         OR listing_id IN (SELECT id FROM market_listing WHERE seller_account_id = ANY($1::bigint[]))`,
      [accs],
    );
    await c.query(
      `DELETE FROM market_listing WHERE seller_account_id = ANY($1::bigint[])`,
      [accs],
    );
    await c.query(
      `DELETE FROM item_instance_entry WHERE account_id = ANY($1::bigint[])
         OR instance_id IN (SELECT id FROM item_instance WHERE owner_account_id = ANY($1::bigint[]))`,
      [accs],
    );
    await c.query(
      `DELETE FROM item_instance WHERE owner_account_id = ANY($1::bigint[])`,
      [accs],
    );
    for (const t of [
      'asset_entry',
      'asset_lot',
      'asset_balance',
      'trade_risk_daily',
    ]) {
      await c.query(`DELETE FROM ${t} WHERE account_id = ANY($1::bigint[])`, [
        accs,
      ]);
    }
    await c.query(`DELETE FROM account WHERE id = ANY($1::bigint[])`, [accs]);
  }

  await c.query(`DELETE FROM "user" WHERE id = $1`, [userId]);
  await sweepOrphanTxns(c);
}

/**
 * 删掉不再被任何分录/实例/挂单引用的凭证头。
 *
 * `asset_txn` 是父表，按 `user_id` 或 `account_id` 都删不到它 ——
 * 玩家清完之后它的凭证头会全部变成孤儿留在库里。
 * `reversal_of` 是自引用，被冲正的原凭证要等冲正凭证先删掉，故扫几轮。
 */
async function sweepOrphanTxns(c) {
  for (let round = 0; round < 3; round += 1) {
    const r = await c.query(
      `DELETE FROM asset_txn t
        WHERE NOT EXISTS (SELECT 1 FROM asset_entry e WHERE e.txn_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM item_instance i WHERE i.minted_txn_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM item_instance_entry ie WHERE ie.txn_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM market_listing l
                           WHERE l.created_txn_id = t.id OR l.settled_txn_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM market_bid b WHERE b.freeze_txn_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM asset_txn x WHERE x.reversal_of = t.id)
        RETURNING t.id`,
    );
    if (r.rowCount === 0) break;
  }
}

/** 清掉该玩家的 Redis 幂等键（24h TTL，但共用开发环境，顺手清免得干扰排查）。 */
async function clearIdemKeys(userId) {
  const redis = new Redis(process.env.REDIS_URL);
  const keys = await redis.keys(`idem:${userId}:*`);
  if (keys.length) await redis.del(...keys);
  await redis.quit();
  return keys.length;
}

module.exports = {
  GAME_COIN,
  MARKETING_POINT,
  db,
  bootApp,
  services,
  fundAsset,
  setAsset,
  balanceOf,
  ownedQty,
  entryCount,
  cleanupUser,
  sweepOrphanTxns,
  clearIdemKeys,
};
