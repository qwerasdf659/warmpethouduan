import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ClockService } from '../common/clock/clock.service';
import { rowsOf } from '../common/db/query-result';
import { BUSINESS_TZ, businessDateString } from '../common/time/business-day';
import { GameConfigService } from '../config/game-config.service';

export interface RiskCheckInput {
  accountId: string;
  userId: string;
  /** 本次交易的计价金额（赠送按参考价估值，用于额度累计） */
  value: number;
}

/**
 * 算「近 7 日成交中位价」至少需要几笔成交。
 *
 * 一两笔算出来的中位价是噪声，用它当告警基准会让告警随机地响或不响，
 * 比没有告警更糟。低于这个样本量就退回商店价。
 */
const MIN_PRICE_SAMPLES = 3;

export interface NetFlowAlert {
  accountId: string;
  userId: string | null;
  netOutflow: number;
  days: number;
}

/**
 * 交易风控。
 *
 * 存在的前提是一个判断：**第三档不做风控，打金工作室三个月就能毁掉经济系统。**
 * 因此这些检查与「定向赠送」同期上线，不是可延后的增强项。
 *
 * 分工上，本服务只管**能在下单前算清楚的规则**（账号年龄、日额度、价格区间），
 * 而「长期单向净流出」这类需要跨天观察的信号落在 `trade_risk_daily` 上、
 * 由日报告警（R4）—— 它不该拦截单次交易，因为单看一笔完全正常。
 */
@Injectable()
export class TradeRiskService {
  private readonly logger = new Logger('TradeRisk');

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly config: GameConfigService,
    private readonly clock: ClockService,
  ) {}

  /** R10 + 分档开关。所有玩家间流转（含易货）写操作的第一道门。 */
  async assertEnabled(
    feature: 'recycle' | 'gift' | 'listing' | 'auction' | 'trade',
  ): Promise<void> {
    if (!(await this.config.get('market.enabled'))) {
      throw new ForbiddenException('交易功能暂未开放');
    }
    const features = await this.config.get('market.features');
    if (!features[feature]) {
      throw new ForbiddenException('该交易方式暂未开放');
    }
  }

  /**
   * R1：新账号交易冷却。
   *
   * 拦的是「注册一批小号 → 立刻把资源汇给大号」这种批量洗号。冷却期让这套流水线
   * 的成本从「注册即用」变成「养号 N 天」，而工作室的账号池周转率是它的核心成本。
   */
  async assertAccountAge(userId: string): Promise<void> {
    const { minAccountAgeDays } = await this.config.get('market.risk');
    if (minAccountAgeDays <= 0) return;

    const rows = rowsOf<{ created_at: Date }>(
      await this.ds.query(`SELECT "created_at" FROM "user" WHERE "id" = $1`, [
        userId,
      ]),
    );
    if (!rows[0]) throw new BadRequestException('玩家不存在');

    const ageDays =
      (this.clock.now().getTime() - new Date(rows[0].created_at).getTime()) /
      86_400_000;
    if (ageDays < minAccountAgeDays) {
      throw new ForbiddenException(
        `注册满 ${minAccountAgeDays} 天后才能交易（还需 ${Math.ceil(
          minAccountAgeDays - ageDays,
        )} 天）`,
      );
    }
  }

  /**
   * R3：单日交易笔数与金额上限。
   *
   * 计数落 `trade_risk_daily` 而不是 Redis：额度是**风控证据**，出事时要能回答
   * 「这个号那天到底交易了多少」。Redis 可丢，而丢掉的恰好是取证材料。
   * 代价是每次交易多一次 UPSERT，相对交易频次可忽略。
   */
  async assertDailyQuota(accountId: string, value: number): Promise<void> {
    const { maxTradesPerDay, maxValuePerDay } =
      await this.config.get('market.risk');

    const rows = rowsOf<{ trade_count: number; trade_value: string }>(
      await this.ds.query(
        `SELECT "trade_count","trade_value" FROM "trade_risk_daily"
          WHERE "account_id" = $1 AND "stat_day" = $2`,
        [accountId, this.dayKey()],
      ),
    );
    const used = rows[0];
    const count = used ? used.trade_count : 0;
    const spent = used ? Number(used.trade_value) : 0;

    if (count >= maxTradesPerDay) {
      throw new ForbiddenException(
        `今日交易次数已达上限（${maxTradesPerDay} 笔）`,
      );
    }
    if (spent + value > maxValuePerDay) {
      throw new ForbiddenException(
        `今日交易额将超出上限（${maxValuePerDay}），已用 ${spent}`,
      );
    }
  }

  /**
   * 记一笔交易到日统计。`netOutflow` 为正表示资产流出本账户。
   *
   * 必须传入调用方的 `EntityManager`：额度累计与成交必须同生共死。分开写的话，
   * 「成交成功但额度没记上」等于额度形同虚设 —— 而这正是攻击者会去反复触发的窗口。
   */
  async record(
    m: EntityManager,
    accountId: string,
    value: number,
    netOutflow: number,
  ): Promise<void> {
    await m.query(
      `INSERT INTO "trade_risk_daily"
         ("account_id","stat_day","trade_count","trade_value","net_outflow")
       VALUES ($1,$2,1,$3,$4)
       ON CONFLICT ("account_id","stat_day")
       DO UPDATE SET "trade_count" = "trade_risk_daily"."trade_count" + 1,
                     "trade_value" = "trade_risk_daily"."trade_value" + EXCLUDED."trade_value",
                     "net_outflow" = "trade_risk_daily"."net_outflow" + EXCLUDED."net_outflow"`,
      [accountId, this.dayKey(), value, netOutflow],
    );
  }

  /**
   * R6：挂单价格区间限制。参考价取商店定价。
   *
   * 下限比上限更重要：「1 币挂一件高价皮肤」是站外私下交易的标准手法
   * （站外微信转账，站内用一个荒谬的低价完成交割）。限价把这条通道压掉之后，
   * 站外交易至少要承担平台价差与手续费。
   */
  async assertPriceBand(referencePrice: number, price: number): Promise<void> {
    const band = await this.config.get('market.priceBand');
    if (!band.enabled || referencePrice <= 0) return;

    const min = Math.floor((referencePrice * band.minBps) / 10_000);
    const max = Math.ceil((referencePrice * band.maxBps) / 10_000);
    if (price < min || price > max) {
      throw new BadRequestException(
        `挂单价需在 ${min}~${max} 之间（参考价 ${referencePrice}）`,
      );
    }
  }

  /**
   * R6 的易货版：两侧估值对等校验。
   *
   * 易货没有「单价」可比，对价是任意物品组合，所以 `assertPriceBand` 用不上。
   * 等价的约束是**两侧估值不能悬殊**：一边价值 10000、另一边 100 的单子，
   * 差额只可能在站外结清，站内这一单只是交割动作。
   *
   * 与限价同源的取舍：宁可放过一些占便宜的正常交易，也不要把「我更想要你这件」
   * 这种真实需求卡死 —— 所以默认倍差给到 3 而不是 1。
   */
  async assertValuationBand(from: number, to: number): Promise<void> {
    const band = await this.config.get('trade.valuationBand');
    if (!band.enabled) return;

    // 一侧为空是单向赠与语义。易货不承担赠送职责（赠送有自己的分档开关与风控），
    // 否则「0 换 N」就成了绕过 gift 开关的后门。
    if (from <= 0 || to <= 0) {
      throw new BadRequestException(
        '易货两侧都必须有标的或对价；单向赠与请走赠送功能',
      );
    }

    const ratio = Math.max(from, to) / Math.min(from, to);
    if (ratio > band.maxRatio) {
      throw new BadRequestException(
        `两侧价值相差过大（${ratio.toFixed(1)} 倍，上限 ${band.maxRatio} 倍）`,
      );
    }
  }

  /**
   * R5：异常价格告警。只记日志，不拦截（拦截是 R6 的职责）。
   *
   * 与 R6 用两套阈值是有意的：告警宁可宽松，因为它的读者是人；
   * 拦截必须严格，因为它的「读者」是正在挂单的玩家，拦错就是功能不可用。
   *
   * **基准优先取近 7 日成交中位价**，样本不足才退回商店价。两者差别很大：
   * 限量收藏品的市场价可以稳定在商店价的数倍，此时拿商店价当基准会把一整类
   * 正常挂单持续报成异常 —— 告警一旦开始狼来了，就等于没有告警。
   * 中位价（而非均价）是因为它对少数极端成交不敏感，而极端成交恰恰是我们要找的东西。
   */
  async warnIfAbnormalPrice(
    assetCode: string,
    shopPrice: number,
    price: number,
    userId: string,
  ): Promise<void> {
    const { abnormalPriceRatio } = await this.config.get('market.risk');
    if (abnormalPriceRatio <= 1) return;

    const median = await this.recentMedianPrice(assetCode);
    const basis = median ?? (shopPrice > 0 ? shopPrice : null);
    if (basis === null) return;

    const ratio = price / basis;
    if (ratio > abnormalPriceRatio || ratio < 1 / abnormalPriceRatio) {
      this.logger.warn(
        `异常挂单价：user=${userId} asset=${assetCode} price=${price} ` +
          `基准=${basis}（${median !== null ? '近 7 日成交中位价' : '商店价，成交样本不足'}）` +
          ` 倍率=${ratio.toFixed(2)}（疑似站外交易通道）`,
      );
    }
  }

  /**
   * 同资产近 7 日成交中位价。样本不足 `MIN_PRICE_SAMPLES` 笔时返回 null。
   *
   * 要求最小样本量是必须的：一两笔成交算出来的「中位价」本身就是噪声，
   * 拿它当基准会让告警随机地响或不响。上线初期没有任何成交，这里恒为 null，
   * 调用方自然退回商店价。
   *
   * 成交时间取的是结算凭证的时间（`settled_txn_id` → `asset_txn.created_at`），
   * 不是挂单创建时间 —— 一张挂 72 小时才卖掉的单，它的价格属于成交那天的行情。
   */
  private async recentMedianPrice(assetCode: string): Promise<number | null> {
    const rows = rowsOf<{ median: string | null; n: string }>(
      await this.ds.query(
        `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY l."price") AS median,
                COUNT(*) AS n
           FROM "market_listing" l
           JOIN "asset_txn" t ON t."id" = l."settled_txn_id"
          WHERE l."asset_code" = $1
            AND l."status" = 'sold'
            AND t."created_at" >= now() - interval '7 days'`,
        [assetCode],
      ),
    );
    const row = rows[0];
    if (!row || row.median === null) return null;
    if (Number(row.n) < MIN_PRICE_SAMPLES) return null;
    return Math.round(Number(row.median));
  }

  /**
   * R4：单向净流出日报。
   *
   * 「A 长期只送 B」是洗号/代练的特征。判定必须跨天看：单看一笔赠送完全正常，
   * 看一周的净流出方向才有信号。
   */
  async netFlowAlerts(days = 7, threshold = 0): Promise<NetFlowAlert[]> {
    const rows = rowsOf<{
      account_id: string;
      user_id: string | null;
      net: string;
    }>(
      await this.ds.query(
        `SELECT r."account_id", a."user_id", SUM(r."net_outflow") AS net
           FROM "trade_risk_daily" r
           JOIN "account" a ON a."id" = r."account_id"
          WHERE r."stat_day" >= (now() AT TIME ZONE '${BUSINESS_TZ}')::date - $1::int
          GROUP BY r."account_id", a."user_id"
         HAVING SUM(r."net_outflow") > $2::bigint
          ORDER BY net DESC
          LIMIT 100`,
        [days, threshold],
      ),
    );
    return rows.map((r) => ({
      accountId: String(r.account_id),
      userId: r.user_id ? String(r.user_id) : null,
      netOutflow: Number(r.net),
      days,
    }));
  }

  /** 业务日（东八区）。额度按自然日重置，与签到等玩法的日切口径一致。 */
  private dayKey(): string {
    return businessDateString(this.clock.now());
  }
}
