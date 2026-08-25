import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { ClockService } from '../../common/clock/clock.service';
import { startOfBusinessDay } from '../../common/time/business-day';
import { User } from '../../entities/user.entity';
import { Pet } from '../../entities/pet.entity';
import { Wallet } from '../../entities/wallet.entity';
import { Ledger } from '../../entities/ledger.entity';
import { RedeemOrder } from '../../entities/redeem-order.entity';

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
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Pet) private readonly pets: Repository<Pet>,
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    @InjectRepository(Ledger) private readonly ledgers: Repository<Ledger>,
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

    const walletSum = await this.wallets
      .createQueryBuilder('w')
      .select('COALESCE(SUM(w.game_coin),0)', 'game')
      .addSelect('COALESCE(SUM(w.marketing_point),0)', 'marketing')
      .getRawOne<{ game: string; marketing: string }>();

    return {
      players: { total, banned, newToday, dauToday },
      pets: { total: totalPets },
      wallet: {
        gameCoinTotal: Number(walletSum?.game ?? 0),
        marketingPointTotal: Number(walletSum?.marketing ?? 0),
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

    const coinRows = await this.ledgers
      .createQueryBuilder('l')
      .select(`to_char(l.created_at AT TIME ZONE :tz, 'YYYYMMDD')`, 'day')
      .addSelect('COALESCE(SUM(l.delta),0)', 'issued')
      .where('l.created_at >= :from', { from })
      .andWhere('l.delta > 0')
      .setParameter('tz', TZ)
      .groupBy('day')
      .getRawMany<{ day: string; issued: string }>();

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
