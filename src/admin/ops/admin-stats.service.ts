import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThanOrEqual, Repository } from 'typeorm';
import { ClockService } from '../../common/clock/clock.service';
import { rowsOf } from '../../common/db/query-result';
import { startOfBusinessDay } from '../../common/time/business-day';
import { User } from '../../entities/user.entity';
import { Pet } from '../../entities/pet.entity';
import { RedeemOrder } from '../../entities/redeem-order.entity';
import { GAME_COIN, MARKETING_POINT } from '../../ledger/ledger.types';

export interface StatsOverview {
  players: {
    total: number;
    banned: number;
    newToday: number;
    dauToday: number;
  };
  pets: { total: number };
  wallet: { gameCoinTotal: number; marketingPointTotal: number };
  exchange: { pendingOrders: number };
}

export interface TrendPoint {
  day: string;
  newUsers: number;
  coinIssued: number;
}

/**
 * 后台数据看板。overview 为实时聚合；trend 给最近 N 天的新增与发币趋势。
 * 无独立埋点表，DAU 以 user.last_seen_at 近似（当日活跃）。
 */
@Injectable()
export class AdminStatsService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Pet) private readonly pets: Repository<Pet>,
    @InjectRepository(RedeemOrder)
    private readonly orders: Repository<RedeemOrder>,
    private readonly clock: ClockService,
  ) {}

  async overview(): Promise<StatsOverview> {
    const now = this.clock.now();
    const dayStart = startOfBusinessDay(now);

    const [total, banned, newToday, dauToday, totalPets, pendingOrders] =
      await Promise.all([
        this.users.count(),
        this.users.count({ where: { status: 'banned' } }),
        this.users.count({ where: { createdAt: MoreThanOrEqual(dayStart) } }),
        this.users.count({ where: { lastSeenAt: MoreThanOrEqual(dayStart) } }),
        this.pets.count(),
        this.orders.count({ where: { status: 'pending' } }),
      ]);

    // 存量口径统计 available + frozen：挂单冻结中的币仍在流通盘里，
    // 只是暂时不可动用，把它排除会让「全服总币量」在市场活跃时凭空少一块
    const walletSum = rowsOf<{ asset_code: string; total: string }>(
      await this.ds.query(
        `SELECT "asset_code", COALESCE(SUM("available" + "frozen"), 0) AS total
           FROM "asset_balance" WHERE "asset_code" = ANY($1::varchar[])
          GROUP BY "asset_code"`,
        [[GAME_COIN, MARKETING_POINT]],
      ),
    );
    const totalOf = (code: string) =>
      Number(walletSum.find((r) => r.asset_code === code)?.total ?? 0);

    return {
      players: { total, banned, newToday, dauToday },
      pets: { total: totalPets },
      wallet: {
        gameCoinTotal: totalOf(GAME_COIN),
        marketingPointTotal: totalOf(MARKETING_POINT),
      },
      exchange: { pendingOrders },
    };
  }

  /** 最近 days 天（含今日）的新增用户与发币趋势（东八区分组）。 */
  async trend(days: number): Promise<{ points: TrendPoint[] }> {
    const capped = Math.min(Math.max(days, 1), 60);
    const now = this.clock.now();
    const from = new Date(
      startOfBusinessDay(now).getTime() - (capped - 1) * 86_400_000,
    );
    const TZ = 'Asia/Shanghai';

    const newRows = await this.users
      .createQueryBuilder('u')
      .select(`to_char(u.created_at AT TIME ZONE :tz, 'YYYYMMDD')`, 'day')
      .addSelect('COUNT(*)', 'cnt')
      .where('u.created_at >= :from', { from })
      .setParameter('tz', TZ)
      .groupBy('day')
      .getRawMany<{ day: string; cnt: string }>();

    // 只数 game_coin 的正向分录：趋势图问的是「每天发了多少游戏币」。
    // 不加 asset_code 过滤的话，营销积分与道具件数会被加进同一根曲线，
    // 得到一个没有单位、也没有意义的数。
    const coinRows = rowsOf<{ day: string; issued: string }>(
      await this.ds.query(
        `SELECT to_char(e."created_at" AT TIME ZONE $1, 'YYYYMMDD') AS day,
                COALESCE(SUM(e."delta"), 0) AS issued
           FROM "asset_entry" e
          WHERE e."created_at" >= $2 AND e."delta" > 0 AND e."asset_code" = $3
          GROUP BY 1`,
        [TZ, from, GAME_COIN],
      ),
    );

    const newMap = new Map(newRows.map((r) => [r.day, Number(r.cnt)]));
    const coinMap = new Map(coinRows.map((r) => [r.day, Number(r.issued)]));

    const points: TrendPoint[] = [];
    for (let i = 0; i < capped; i++) {
      const d = new Date(from.getTime() + i * 86_400_000);
      // 用东八区日历日键
      const shifted = new Date(d.getTime() + 8 * 3_600_000);
      const key = `${shifted.getUTCFullYear()}${`${shifted.getUTCMonth() + 1}`.padStart(2, '0')}${`${shifted.getUTCDate()}`.padStart(2, '0')}`;
      points.push({
        day: key,
        newUsers: newMap.get(key) ?? 0,
        coinIssued: coinMap.get(key) ?? 0,
      });
    }
    return { points };
  }
}
