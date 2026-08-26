import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * 交易风控日统计。第三档不做风控，打金工作室三个月就能毁掉经济系统，
 * 因此这张表与「定向赠送」同期上线，不可延后。
 */
@Entity('trade_risk_daily')
export class TradeRiskDaily {
  @PrimaryColumn({ name: 'account_id', type: 'bigint' })
  accountId: string;

  @PrimaryColumn({ name: 'stat_day', type: 'date' })
  statDay: string;

  @Column({ name: 'trade_count', type: 'int', default: 0 })
  tradeCount: number;

  /** 当日交易额（按计价资产累计） */
  @Column({ name: 'trade_value', type: 'bigint', default: 0 })
  tradeValue: string;

  /**
   * 送出 − 收到。长期为正值 = 洗号 / 代练嫌疑：
   * 正常玩家的赠送是双向的，单向净流出是「小号供养大号」的特征。
   */
  @Column({ name: 'net_outflow', type: 'bigint', default: 0 })
  netOutflow: string;
}
