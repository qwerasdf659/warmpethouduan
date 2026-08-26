import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 决策 D1 的配置侧落地：把 `gacha.pools` 里的货币档位换成道具与消耗品。
 *
 * **为什么必须写迁移，而不是只改代码默认值**：`GameConfigService` 的播种只补
 * 缺失的 key，**不覆盖已存在的行**（否则运营在后台做的任何调整都会在下次重启时
 * 被静默还原）。所以老库里那份带 `kind:'coin'` 的奖池会一直留着 ——
 * 它虽然会因为不通过新 schema 而回退到代码默认值（玩法侧是对的），
 * 但每次配置重载都打一条 ERROR 日志，而且后台配置页展示的是那份已经不合法的旧值。
 *
 * 值在这里**写死**而不是 import 代码常量：迁移是历史快照，
 * 引用会随版本漂移的常量会让「重放迁移」得到与当初不同的结果。
 */
export class GachaRemoveCoinPayout1787900100000 implements MigrationInterface {
  name = 'GachaRemoveCoinPayout1787900100000';

  /**
   * 权重说明：原两档零钱（60 币 420‰、200 币 260‰）占去 68% 权重，
   * 移除后并入消耗品档 —— 消耗品同样是「用得掉、不积累」的产出，
   * 经济学作用与小额零钱一致，因此扭蛋作为 sink 的定位不变。
   */
  private readonly NEW_POOLS = [
    {
      key: 'daily',
      name: '日常扭蛋',
      pool: 'game',
      cost: 300,
      costTen: 2700,
      pity: 30,
      dupeItemKey: 'cons_snack',
      dupeQty: 2,
      entries: [
        {
          key: 'snack',
          name: '宠物零食 ×3',
          weight: 420,
          itemKey: 'cons_snack',
          qty: 3,
          rare: false,
        },
        {
          key: 'bubble',
          name: '清洁泡泡 ×3',
          weight: 260,
          itemKey: 'cons_bubble',
          qty: 3,
          rare: false,
        },
        {
          key: 'energy',
          name: '能量饮 ×2',
          weight: 140,
          itemKey: 'cons_energy',
          qty: 2,
          rare: false,
        },
        {
          key: 'cake',
          name: '生日蛋糕 ×1',
          weight: 150,
          itemKey: 'cons_cake',
          qty: 1,
          rare: false,
        },
        {
          key: 'bg_beach',
          name: '海边夕照（背景）',
          weight: 20,
          itemKey: 'bg_beach',
          qty: 1,
          rare: true,
        },
        {
          key: 'skin_shadow',
          name: '玄影（皮肤）',
          weight: 10,
          itemKey: 'skin_shadow',
          qty: 1,
          rare: true,
        },
      ],
    },
  ];

  private readonly DESCRIPTION =
    '扭蛋奖池：权重、单抽/十连价格、保底抽数、重复收藏品的补偿道具。产出只有道具与消耗品（不产币），概率由权重实时换算并对外公示';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE "game_config" SET "value" = $1, "description" = $2 WHERE "key" = 'gacha.pools'`,
      [JSON.stringify(this.NEW_POOLS), this.DESCRIPTION],
    );
  }

  /**
   * 回滚到带货币档位的旧奖池。
   *
   * ⚠ 回滚后 `game_coin` 会重新成为扭蛋产出，而它必须 `tradable`（交易媒介）——
   * 两者同时为真会被 `ck_asset_no_trade_gacha` 拦住。因此回滚这条迁移必须
   * **同时**回滚账本重构（否则奖池配置与资产开关互相矛盾）。
   */
  public async down(q: QueryRunner): Promise<void> {
    const oldPools = [
      {
        key: 'daily',
        name: '日常扭蛋',
        pool: 'game',
        cost: 300,
        costTen: 2700,
        pity: 30,
        dupeCoin: 120,
        entries: [
          {
            key: 'coin_small',
            name: '零钱 60',
            weight: 420,
            kind: 'coin',
            amount: 60,
            itemKey: null,
            qty: 0,
            rare: false,
          },
          {
            key: 'coin_mid',
            name: '零钱 200',
            weight: 260,
            kind: 'coin',
            amount: 200,
            itemKey: null,
            qty: 0,
            rare: false,
          },
          {
            key: 'snack',
            name: '宠物零食 ×3',
            weight: 140,
            kind: 'item',
            amount: 0,
            itemKey: 'cons_snack',
            qty: 3,
            rare: false,
          },
          {
            key: 'energy',
            name: '能量饮 ×2',
            weight: 90,
            kind: 'item',
            amount: 0,
            itemKey: 'cons_energy',
            qty: 2,
            rare: false,
          },
          {
            key: 'cake',
            name: '生日蛋糕 ×1',
            weight: 60,
            kind: 'item',
            amount: 0,
            itemKey: 'cons_cake',
            qty: 1,
            rare: false,
          },
          {
            key: 'bg_beach',
            name: '海边夕照（背景）',
            weight: 20,
            kind: 'item',
            amount: 0,
            itemKey: 'bg_beach',
            qty: 1,
            rare: true,
          },
          {
            key: 'skin_shadow',
            name: '玄影（皮肤）',
            weight: 10,
            kind: 'item',
            amount: 0,
            itemKey: 'skin_shadow',
            qty: 1,
            rare: true,
          },
        ],
      },
    ];
    await q.query(
      `UPDATE "game_config" SET "value" = $1,
              "description" = '扭蛋奖池：权重、单抽/十连价格、保底抽数、重复收藏品折算币量。概率由权重实时换算并对外公示'
        WHERE "key" = 'gacha.pools'`,
      [JSON.stringify(oldPools)],
    );
  }
}
