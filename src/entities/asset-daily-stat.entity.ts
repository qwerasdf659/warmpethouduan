import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * 资产发行/销毁日报。一表三用：
 *  - **通胀监控**（数值策划）：某资产每日净发行趋势
 *  - **刷币外挂告警**：某 `reason` 的产出突增
 *  - **待兑付负债**（财务）：`marketing_point` 的累计发行 − 累计兑付
 *
 * 它承担的正是 `issue`/`burn` 单边凭证放弃的那部分口径 —— 发行与销毁不守恒，
 * 所以「本月发了多少币」不能靠分录求和推出，必须单独物化。
 */
@Entity({ name: 'asset_daily_stat', synchronize: false })
export class AssetDailyStat {
  @PrimaryColumn({ name: 'stat_day', type: 'date' })
  statDay: string;

  @PrimaryColumn({ name: 'asset_code', type: 'varchar', length: 48 })
  assetCode: string;

  @PrimaryColumn({ type: 'varchar', length: 32 })
  reason: string;

  /** 正向 delta 汇总 */
  @Column({ type: 'bigint', default: 0 })
  issued: string;

  /** 负向 delta 汇总（取绝对值） */
  @Column({ type: 'bigint', default: 0 })
  burned: string;
}
