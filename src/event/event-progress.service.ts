import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

interface CachedTask {
  eventKey: string;
  taskKey: string;
  target: number;
  source: string;
}

/**
 * 活动任务进度递增（P12）。
 *
 * 玩家行为（互动/签到/赛跑/小游戏/…）通过 `bump(userId, source)` 推进匹配 `source` 的任务进度。
 * 设计要点：
 *  - **软失败**：进度是非关键旁路，任何异常都吞掉并记 warn，绝不阻断主玩法动作；
 *  - **热路径低开销**：活动列表按 30 秒内存缓存，无进行中的 task 型活动时 bump 近乎零成本；
 *  - **原子累加**：用 `ON CONFLICT ... LEAST(target, progress+delta)` 一句 upsert，封顶在 target。
 *
 * 任务定义在 `game_event.payload.tasks[].source` 声明来源（如 'interact'|'login'|'race'|'minigame'）。
 */
@Injectable()
export class EventProgressService {
  private readonly logger = new Logger('EventProgress');
  private cache: { at: number; tasks: CachedTask[] } | null = null;

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  private async activeTasks(nowMs: number): Promise<CachedTask[]> {
    if (this.cache && nowMs - this.cache.at < 30_000) return this.cache.tasks;
    const rows = await this.ds.query<
      { key: string; payload: { tasks?: unknown[] } }[]
    >(
      `SELECT key, payload FROM game_event
        WHERE enabled = true AND type = 'task'
          AND starts_at <= now() AND ends_at > now()`,
    );
    const tasks: CachedTask[] = [];
    for (const e of rows) {
      const list = Array.isArray(e.payload?.tasks) ? e.payload.tasks : [];
      for (const t of list as {
        taskKey?: string;
        target?: number;
        source?: string;
      }[]) {
        if (t.taskKey && t.source && typeof t.target === 'number') {
          tasks.push({
            eventKey: e.key,
            taskKey: t.taskKey,
            target: t.target,
            source: t.source,
          });
        }
      }
    }
    this.cache = { at: nowMs, tasks };
    return tasks;
  }

  /** 推进 source 匹配的所有进行中活动任务进度（软失败，绝不抛）。 */
  async bump(userId: string, source: string, delta = 1): Promise<void> {
    try {
      const tasks = await this.activeTasks(Date.now());
      for (const t of tasks) {
        if (t.source !== source) continue;
        await this.ds.query(
          `INSERT INTO event_progress (user_id, event_key, task_key, progress, updated_at)
             VALUES ($1, $2, $3, LEAST($4, $5), now())
           ON CONFLICT (user_id, event_key, task_key)
           DO UPDATE SET progress = LEAST($5, event_progress.progress + $4),
                         updated_at = now()`,
          [userId, t.eventKey, t.taskKey, delta, t.target],
        );
      }
    } catch (e) {
      this.logger.warn(`event bump failed (ignored): ${(e as Error).message}`);
    }
  }
}
