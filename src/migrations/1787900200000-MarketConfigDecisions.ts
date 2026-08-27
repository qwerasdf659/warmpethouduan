import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 交易开门前的三项配置决策落地（D4 手续费率 / D5 限价区间 / D12 风控阈值）。
 *
 * **为什么必须写迁移**：`GameConfigService` 的播种只补缺失的 key，
 * **不覆盖已存在的行**（否则运营在后台做的任何调整都会在下次重启时被静默还原）。
 * `market.*` 那几行在账本重构落地时就已按当时的默认值播种进库，
 * 光改 `market.config.ts` 的默认值对现有库毫无作用 —— 这个坑上一轮在
 * `gacha.pools` 上已经踩过一次（见 `GachaRemoveCoinPayout` 迁移）。
 *
 * 值在这里写死而不是 import 代码常量：迁移是历史快照，引用会漂移的常量
 * 会让「重放迁移」得到与当初不同的结果。
 *
 * ⚠ 本迁移**不动** `market.enabled` 与 `market.features`：它们保持全关。
 * 定阈值和开门是两件事 —— 开门要运营在后台显式点，而不是被一次部署带开。
 */
export class MarketConfigDecisions1787900200000 implements MigrationInterface {
  name = 'MarketConfigDecisions1787900200000';

  /**
   * D5：下限 30% → 50%，上限 300% → 1000%。
   *
   * 下限是站外私下交易的主要摩擦源（他们要的是尽可能低的挂单价），
   * 而 30% 恰好等于系统回收率、市场毫无存在意义；上限放宽是因为限量编号的
   * 收藏溢价是 D3 的既定玩法，300% 会压死它。详见 `market.config.ts` 注释。
   */
  private readonly PRICE_BAND = {
    enabled: true,
    minBps: 5_000,
    maxBps: 100_000,
  };

  /**
   * D12：日额度 50000 → 100000，异常价告警倍率 5 → 8。
   *
   * 额度必须与限价上限联动：限量款顶价成交可达 50000，日额度也是 50000 的话，
   * 玩家买一件正常收藏品就锁死当天。
   */
  private readonly RISK = {
    minAccountAgeDays: 7,
    maxTradesPerDay: 20,
    maxValuePerDay: 100_000,
    abnormalPriceRatio: 8,
  };

  /** D4：固定 500 bps，不做阶梯。与落地前一致，写进来是为了让决策有落点。 */
  private readonly FEE_BPS = 500;

  public async up(q: QueryRunner): Promise<void> {
    await this.set(q, 'market.priceBand', this.PRICE_BAND);
    await this.set(q, 'market.risk', this.RISK);
    await this.set(q, 'market.feeBps', this.FEE_BPS);
  }

  public async down(q: QueryRunner): Promise<void> {
    await this.set(q, 'market.priceBand', {
      enabled: true,
      minBps: 3_000,
      maxBps: 30_000,
    });
    await this.set(q, 'market.risk', {
      minAccountAgeDays: 7,
      maxTradesPerDay: 20,
      maxValuePerDay: 50_000,
      abnormalPriceRatio: 5,
    });
    await this.set(q, 'market.feeBps', 500);
  }

  /**
   * 只更新已存在的行，不插入。
   *
   * 缺行的情况交给启动播种（它会按代码默认值补齐，而代码默认值与本迁移一致）。
   * 在这里 INSERT 反而要复制一份 description，将来改文案就有两处真相。
   */
  private async set(
    q: QueryRunner,
    key: string,
    value: unknown,
  ): Promise<void> {
    await q.query(`UPDATE "game_config" SET "value" = $2 WHERE "key" = $1`, [
      key,
      JSON.stringify(value),
    ]);
  }
}
