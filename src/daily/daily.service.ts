import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import { ClockService } from '../common/clock/clock.service';
import { LockService } from '../common/lock/lock.service';
import { businessDayKey, isConsecutiveDay } from '../common/time/business-day';
import { GameConfigService } from '../config/game-config.service';
import { EconomyService } from '../economy/economy.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { Daily } from '../entities/daily.entity';
import {
  CheckinConfig,
  DailyTaskConfig,
  DailyTaskSource,
  checkinRewardOf,
} from './daily.config';

/** 一次请求内用到的签到配置快照，保证同一响应里预告与实发口径一致。 */
interface DailyTuning {
  checkin: CheckinConfig;
  tasks: DailyTaskConfig[];
}

export interface DailyTaskView {
  key: string;
  name: string;
  target: number;
  progress: number;
  coin: number;
  done: boolean;
  claimed: boolean;
}

export interface DailyView {
  checkin: {
    done: boolean;
    streak: number;
    totalCheckins: number;
    /** 今日若签到可得（已签到则为本次已得）游戏币 */
    todayReward: number;
    /** 连签下一天的奖励预告 */
    nextReward: number;
  };
  tasks: DailyTaskView[];
}

/**
 * 签到 + 每日任务。玩家级锁串行写；奖励一律经 EconomyService.apply 发放。
 * 任务进度来自 Redis 计数器（宠物互动时累加），签到态落 daily 表。
 */
@Injectable()
export class DailyService {
  constructor(
    @InjectRepository(Daily)
    private readonly dailies: Repository<Daily>,
    private readonly clock: ClockService,
    private readonly lock: LockService,
    private readonly economy: EconomyService,
    private readonly config: GameConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** 签到状态 + 任务列表（只读，不落库）。 */
  async getDaily(userId: string): Promise<DailyView> {
    const tuning = await this.tuning();
    const now = this.clock.now();
    const day = businessDayKey(now);
    const row = await this.dailies.findOne({ where: { userId } });
    return this.toView(
      row,
      day,
      await this.readProgress(userId, day, row),
      tuning,
    );
  }

  /**
   * 每日签到：一天一次，按连签天数发放游戏币。
   *
   * 幂等键用服务端派生的 `daily:checkin:{day}` 而非客户端 bizId——
   * 客户端换个 bizId 就能重复领奖的话，「一天一次」形同虚设。
   */
  async checkin(
    userId: string,
  ): Promise<{ daily: DailyView; gained: number; gameCoin: number }> {
    const tuning = await this.tuning();
    return this.lock.withLock(`pet:${userId}`, async () => {
      const now = this.clock.now();
      const day = businessDayKey(now);
      const row = await this.ensureRow(userId);

      if (row.lastCheckinDay === day) {
        throw new BadRequestException('今日已签到');
      }

      const streak =
        row.lastCheckinDay && isConsecutiveDay(row.lastCheckinDay, day)
          ? row.streak + 1
          : 1;
      const reward = checkinRewardOf(streak, tuning.checkin);

      row.lastCheckinDay = day;
      row.streak = streak;
      row.totalCheckins += 1;
      await this.dailies.save(row);

      const applied = await this.economy.apply({
        userId,
        pool: 'game',
        delta: reward,
        bizId: `daily:checkin:${day}`,
        reason: 'daily',
        refId: day,
      });

      const progress = await this.readProgress(userId, day, row);
      return {
        daily: this.toView(row, day, progress, tuning),
        gained: reward,
        gameCoin: applied.wallet.gameCoin,
      };
    });
  }

  /**
   * 领取某项每日任务奖励（进度达标且未领取）。
   * 同签到，幂等键由服务端按 `{day}:{taskKey}` 派生。
   */
  async claimTask(
    userId: string,
    taskKey: string,
  ): Promise<{ daily: DailyView; gained: number; gameCoin: number }> {
    const tuning = await this.tuning();
    const cfg = tuning.tasks.find((t) => t.key === taskKey);
    if (!cfg) throw new BadRequestException('未知任务');

    return this.lock.withLock(`pet:${userId}`, async () => {
      const now = this.clock.now();
      const day = businessDayKey(now);
      const row = await this.ensureRow(userId);

      // task_day 变化视为新的一天：清空当日已领取集合
      if (row.taskDay !== day) {
        row.taskDay = day;
        row.claimedTasks = [];
      }
      if (row.claimedTasks.includes(taskKey)) {
        throw new BadRequestException('该任务今日已领取');
      }

      const progress = await this.readProgress(userId, day, row);
      const cur = progress[cfg.source] ?? 0;
      if (cur < cfg.target) {
        throw new BadRequestException('任务尚未完成');
      }

      row.claimedTasks = [...row.claimedTasks, taskKey];
      await this.dailies.save(row);

      const applied = await this.economy.apply({
        userId,
        pool: 'game',
        delta: cfg.coin,
        bizId: `daily:task:${day}:${taskKey}`,
        reason: 'daily',
        refId: taskKey,
      });

      return {
        daily: this.toView(row, day, progress, tuning),
        gained: cfg.coin,
        gameCoin: applied.wallet.gameCoin,
      };
    });
  }

  // ---------------------------------------------------------------- 内部

  private async tuning(): Promise<DailyTuning> {
    const cfg = await this.config.snapshot();
    return { checkin: cfg['daily.checkin'], tasks: cfg['daily.tasks'] };
  }

  private async ensureRow(userId: string): Promise<Daily> {
    const existing = await this.dailies.findOne({ where: { userId } });
    if (existing) return existing;
    // 并发下靠 uq_daily_user_id 兜底：撞唯一键则回查已存在行
    try {
      return await this.dailies.save(
        this.dailies.create({
          userId,
          streak: 0,
          totalCheckins: 0,
          claimedTasks: [],
        }),
      );
    } catch {
      const row = await this.dailies.findOne({ where: { userId } });
      if (row) return row;
      throw new BadRequestException('签到初始化失败');
    }
  }

  /** 读各进度来源的当前值（checkin 由 daily 行推出，其余读 Redis 计数器）。 */
  private async readProgress(
    userId: string,
    day: string,
    row: Daily | null,
  ): Promise<Record<DailyTaskSource, number>> {
    const act = parseInt(
      (await this.redis.get(`act:${userId}:${day}`)) ?? '0',
      10,
    );
    const play = parseInt(
      (await this.redis.get(`act:${userId}:${day}:play`)) ?? '0',
      10,
    );
    const checkin = row?.lastCheckinDay === day ? 1 : 0;
    return { act, play, checkin };
  }

  private toView(
    row: Daily | null,
    day: string,
    progress: Record<DailyTaskSource, number>,
    tuning: DailyTuning,
  ): DailyView {
    const checkedInToday = row?.lastCheckinDay === day;
    const currentStreak = row?.streak ?? 0;
    // 已签到 → 展示本次已得；未签到 → 展示今日可得（按连签规则预测）
    const predictedStreak = checkedInToday
      ? currentStreak
      : row?.lastCheckinDay && isConsecutiveDay(row.lastCheckinDay, day)
        ? currentStreak + 1
        : 1;

    const claimed = new Set(
      row?.taskDay === day ? (row?.claimedTasks ?? []) : [],
    );

    return {
      checkin: {
        done: checkedInToday,
        streak: currentStreak,
        totalCheckins: row?.totalCheckins ?? 0,
        todayReward: checkinRewardOf(predictedStreak, tuning.checkin),
        nextReward: checkinRewardOf(predictedStreak + 1, tuning.checkin),
      },
      tasks: tuning.tasks.map((t) => {
        const cur = progress[t.source] ?? 0;
        return {
          key: t.key,
          name: t.name,
          target: t.target,
          progress: Math.min(cur, t.target),
          coin: t.coin,
          done: cur >= t.target,
          claimed: claimed.has(t.key),
        };
      }),
    };
  }
}
