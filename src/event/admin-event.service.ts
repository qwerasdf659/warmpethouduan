import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GameEvent } from '../entities/game-event.entity';
import { EventProgress } from '../entities/event-progress.entity';
import { CreateEventDto, UpdateEventDto } from './dto/event.dto';

/**
 * 限时活动后台 CRUD（P12）。
 *
 * 活动是表驱动的：多活动并存、按时间窗口查询、运营增删改单个活动，
 * 所以走独立的 `game_event` 表而不是塞进 game_config。
 */
@Injectable()
export class AdminEventService {
  constructor(
    @InjectRepository(GameEvent)
    private readonly events: Repository<GameEvent>,
    @InjectRepository(EventProgress)
    private readonly progress: Repository<EventProgress>,
  ) {}

  /** 全部活动分页（含未启用/已结束），按开始时间倒序。 */
  async list(
    page: number,
    pageSize: number,
  ): Promise<{ list: GameEvent[]; total: number }> {
    const [list, total] = await this.events.findAndCount({
      order: { startsAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { list, total };
  }

  async create(dto: CreateEventDto): Promise<{ event: GameEvent }> {
    const exists = await this.events.findOne({ where: { key: dto.key } });
    if (exists) throw new BadRequestException('活动 key 已存在');

    const starts = new Date(dto.startsAt);
    const ends = new Date(dto.endsAt);
    if (ends <= starts) {
      throw new BadRequestException('结束时间必须晚于开始时间');
    }

    const event = await this.events.save(
      this.events.create({
        key: dto.key,
        name: dto.name,
        type: dto.type,
        startsAt: starts,
        endsAt: ends,
        banner: dto.banner ?? null,
        payload: dto.payload ?? {},
        enabled: dto.enabled ?? true,
      }),
    );
    return { event };
  }

  async update(
    key: string,
    dto: UpdateEventDto,
  ): Promise<{ event: GameEvent }> {
    const event = await this.events.findOne({ where: { key } });
    if (!event) throw new NotFoundException('活动不存在');

    if (dto.name !== undefined) event.name = dto.name;
    if (dto.type !== undefined) event.type = dto.type;
    if (dto.startsAt !== undefined) event.startsAt = new Date(dto.startsAt);
    if (dto.endsAt !== undefined) event.endsAt = new Date(dto.endsAt);
    if (dto.banner !== undefined) event.banner = dto.banner ?? null;
    if (dto.payload !== undefined) event.payload = dto.payload;
    if (dto.enabled !== undefined) event.enabled = dto.enabled;

    if (event.endsAt <= event.startsAt) {
      throw new BadRequestException('结束时间必须晚于开始时间');
    }

    const saved = await this.events.save(event);
    return { event: saved };
  }

  async remove(key: string): Promise<{ ok: true }> {
    const event = await this.events.findOne({ where: { key } });
    if (!event) throw new NotFoundException('活动不存在');
    await this.events.delete({ key });
    return { ok: true };
  }

  /** 某活动的玩家进度分页（客服排查用）。 */
  async progressOf(
    key: string,
    page: number,
    pageSize: number,
  ): Promise<{ list: EventProgress[]; total: number }> {
    const [list, total] = await this.progress.findAndCount({
      where: { eventKey: key },
      order: { updatedAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { list, total };
  }
}
