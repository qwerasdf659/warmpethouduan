import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { ClockService } from '../common/clock/clock.service';
import { LockService } from '../common/lock/lock.service';
import { EconomyService, WalletView } from '../economy/economy.service';
import { Reward, RewardService } from '../ledger/reward.service';
import { GameEvent, GameEventType } from '../entities/game-event.entity';
import { EventProgress } from '../entities/event-progress.entity';

/** 活动任务定义（存在 `game_event.payload.tasks` 里）。 */
interface EventTask {
  taskKey: string;
  name: string;
  target: number;
  reward: Reward;
}

/** GET /event/current 单条视图。 */
export interface CurrentEventView {
  key: string;
  name: string;
  type: GameEventType;
  startsAt: Date;
  endsAt: Date;
  /** 服务端算出的剩余秒数，前端不得用本地时间判断结束。 */
  remainSec: number;
  banner: string | null;
  payload: Record<string, unknown>;
}

/** GET /event/progress 单条视图。 */
export interface EventTaskProgressView {
  taskKey: string;
  name: string;
  target: number;
  progress: number;
  claimed: boolean;
  reward: Reward;
}

export interface EventClaimResult {
  gained: Reward[];
  wallet: WalletView;
  duplicated: boolean;
}

/**
 * 限时活动玩家端（P12）。
 *
 * 活动完全表驱动（`game_event` / `event_progress`），无 game_config 项。
 * 时间一律走 `ClockService`：活动是否开放、剩余多久都由服务端判定，
 * 客户端上报的时间不作数。
 */
@Injectable()
export class EventService {
  constructor(
    @InjectRepository(GameEvent)
    private readonly events: Repository<GameEvent>,
    @InjectRepository(EventProgress)
    private readonly progress: Repository<EventProgress>,
    private readonly clock: ClockService,
    private readonly lock: LockService,
    private readonly reward: RewardService,
    private readonly economy: EconomyService,
  ) {}

  /** 当前开放中的活动（enabled 且落在 [startsAt, endsAt) 窗口内）。 */
  async current(): Promise<{ list: CurrentEventView[]; total: number }> {
    const now = this.clock.now();
    const rows = await this.events.find({
      where: {
        enabled: true,
        startsAt: LessThanOrEqual(now),
        endsAt: MoreThan(now),
      },
      order: { startsAt: 'ASC' },
    });
    const list = rows.map((e) => ({
      key: e.key,
      name: e.name,
      type: e.type,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      remainSec: this.remainSec(e.endsAt, now),
      banner: e.banner,
      payload: e.payload ?? {},
    }));
    return { list, total: list.length };
  }

  /** 某活动的任务进度（任务清单来自 payload，进度合并玩家的 event_progress 行）。 */
  async progressOf(
    userId: string,
    eventKey: string,
  ): Promise<{ list: EventTaskProgressView[]; total: number }> {
    const event = await this.events.findOne({ where: { key: eventKey } });
    if (!event) return { list: [], total: 0 };

    const tasks = this.tasksOf(event);
    const rows = await this.progress.find({ where: { userId, eventKey } });
    const byTask = new Map(rows.map((r) => [r.taskKey, r]));

    const list = tasks.map((t) => {
      const row = byTask.get(t.taskKey);
      return {
        taskKey: t.taskKey,
        name: t.name,
        target: t.target,
        progress: row?.progress ?? 0,
        claimed: row?.claimedAt != null,
        reward: t.reward,
      };
    });
    return { list, total: list.length };
  }

  /** 领取活动任务奖励。达标且未领取才发放，锁串行化防并发重复领取。 */
  async claim(
    userId: string,
    dto: { bizId: string; eventKey: string; taskKey: string },
  ): Promise<EventClaimResult> {
    return this.lock.withLock(`event:${userId}`, async () => {
      const now = this.clock.now();
      const event = await this.events.findOne({
        where: { key: dto.eventKey },
      });
      if (!event || now < event.startsAt) {
        throw new BadRequestException('活动未开始');
      }
      if (!event.enabled || now >= event.endsAt) {
        throw new BadRequestException('活动已结束');
      }

      const task = this.tasksOf(event).find((t) => t.taskKey === dto.taskKey);
      if (!task) throw new BadRequestException('任务不存在');

      let row = await this.progress.findOne({
        where: { userId, eventKey: dto.eventKey, taskKey: dto.taskKey },
      });
      if (!row) {
        row = this.progress.create({
          userId,
          eventKey: dto.eventKey,
          taskKey: dto.taskKey,
          progress: 0,
          claimedAt: null,
        });
      }

      if (row.progress < task.target) {
        throw new BadRequestException('任务未完成');
      }
      if (row.claimedAt != null) {
        throw new BadRequestException('奖励已领取');
      }

      const rewards: Reward[] = [
        { assetCode: task.reward.assetCode, count: task.reward.count },
      ];
      const result = await this.reward.grant(userId, rewards, {
        reason: 'event',
        bizKey: dto.bizId,
        refType: 'event',
        refId: `${dto.eventKey}:${dto.taskKey}`,
      });

      row.claimedAt = now;
      await this.progress.save(row);

      const wallet = await this.economy.getWallet(userId);
      return { gained: rewards, wallet, duplicated: result.duplicated };
    });
  }

  // ---------------------------------------------------------------- 内部

  /** 剩余秒数（下限 0，避免时钟抖动出现负值）。 */
  private remainSec(endsAt: Date, now: Date): number {
    return Math.max(0, Math.floor((endsAt.getTime() - now.getTime()) / 1000));
  }

  /** 从 payload 里安全取任务清单（非 task 型活动没有 tasks，返回空数组）。 */
  private tasksOf(event: GameEvent): EventTask[] {
    const tasks = (event.payload as { tasks?: unknown })?.tasks;
    return Array.isArray(tasks) ? (tasks as EventTask[]) : [];
  }
}
