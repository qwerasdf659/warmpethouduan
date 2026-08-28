import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClockService } from '../../common/clock/clock.service';
import { LockService } from '../../common/lock/lock.service';
import { User } from '../../entities/user.entity';
import type { PetStateView } from '../../pet/pet-math';
import { type AdminAdjustInput, PetService } from '../../pet/pet.service';
import { ItemsService } from '../../items/items.service';
import { AdjustPetDto, GrantItemDto } from './dto/player-write.dto';
import { QueryPlayersDto } from './dto/query-players.dto';

export interface PlayerView {
  id: string;
  openid: string;
  unionid: string | null;
  status: 'active' | 'banned';
  bannedReason: string | null;
  bannedAt: Date | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AdminPlayersService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly pet: PetService,
    private readonly lock: LockService,
    private readonly clock: ClockService,
    private readonly items: ItemsService,
  ) {}

  private toView(u: User): PlayerView {
    return {
      id: u.id,
      openid: u.openid,
      unionid: u.unionid,
      status: u.status,
      bannedReason: u.bannedReason,
      bannedAt: u.bannedAt,
      lastSeenAt: u.lastSeenAt,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    };
  }

  /** 玩家分页列表，keyword 模糊匹配 id/openid/unionid，可再按账号状态筛。 */
  async list(
    q: QueryPlayersDto,
  ): Promise<{ list: PlayerView[]; total: number }> {
    const qb = this.users
      .createQueryBuilder('u')
      .orderBy('u.id', 'DESC')
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize);

    if (q.keyword) {
      // 整段关键词条件用括号包住：与 status 用 AND 串联时，不加括号会变成
      // 「id 匹配 OR openid 匹配 OR (unionid 匹配 AND status=banned)」
      qb.andWhere(
        '(CAST(u.id AS TEXT) ILIKE :kw OR u.openid ILIKE :kw OR u.unionid ILIKE :kw)',
        { kw: `%${q.keyword}%` },
      );
    }
    if (q.status) {
      qb.andWhere('u.status = :status', { status: q.status });
    }

    const [rows, total] = await qb.getManyAndCount();
    return { list: rows.map((r) => this.toView(r)), total };
  }

  /**
   * 玩家详情：账户信息 + 名下**全部**宠物的结算后状态（多宠）。
   * 走 PetService.peekPets，与玩家端同一套结算逻辑，且只读不建宠。
   */
  async detail(
    id: string,
  ): Promise<{ player: PlayerView; pets: PetStateView[] }> {
    const u = await this.users.findOne({ where: { id } });
    if (!u) throw new NotFoundException('玩家不存在');
    return { player: this.toView(u), pets: await this.pet.peekPets(id) };
  }

  // ----------------------------------------------------------- 受控写操作

  /** 封禁玩家：置 status=banned，记录原因与时间。玩家级锁串行。 */
  async ban(id: string, reason?: string): Promise<{ player: PlayerView }> {
    return this.lock.withLock(`player:${id}`, async () => {
      const u = await this.users.findOne({ where: { id } });
      if (!u) throw new NotFoundException('玩家不存在');
      u.status = 'banned';
      u.bannedReason = reason ?? null;
      u.bannedAt = this.clock.now();
      return { player: this.toView(await this.users.save(u)) };
    });
  }

  /** 解封玩家：恢复 status=active，清空封禁原因/时间。 */
  async unban(id: string): Promise<{ player: PlayerView }> {
    return this.lock.withLock(`player:${id}`, async () => {
      const u = await this.users.findOne({ where: { id } });
      if (!u) throw new NotFoundException('玩家不存在');
      u.status = 'active';
      u.bannedReason = null;
      u.bannedAt = null;
      return { player: this.toView(await this.users.save(u)) };
    });
  }

  /** 宠物补偿/纠偏：委托 PetService.adminAdjust（玩家级锁 + 结算 + 截断）。 */
  async adjustPet(
    id: string,
    dto: AdjustPetDto,
  ): Promise<{ pet: PetStateView }> {
    const u = await this.users.findOne({
      where: { id },
      select: { id: true },
    });
    if (!u) throw new NotFoundException('玩家不存在');
    const input: AdminAdjustInput = {
      petId: dto.petId,
      mode: dto.mode ?? 'delta',
      hunger: dto.hunger,
      mood: dto.mood,
      cleanliness: dto.cleanliness,
      stamina: dto.stamina,
      intimacy: dto.intimacy,
      exp: dto.exp,
    };
    return this.pet.adminAdjust(id, input);
  }

  /**
   * 补发装扮/家具/背景：委托 `ItemsService.grant`。
   *
   * `bizId` 落 `asset_txn.biz_id`，同一 bizId 重复提交是幂等回放。这份保证必须
   * 来自数据库唯一约束而不是 `IdempotencyInterceptor` 的 Redis 窗口——窗口一过，
   * 隔日重发同一张工单就会真的再补一件，且发放没有流水可查。
   */
  async grantItem(
    id: string,
    dto: GrantItemDto,
  ): Promise<{ assetCode: string; qty: number; granted: number }> {
    const u = await this.users.findOne({
      where: { id },
      select: { id: true },
    });
    if (!u) throw new NotFoundException('玩家不存在');
    return this.items.grant(
      id,
      dto.assetCode,
      dto.qty ?? 1,
      `admin:grant:${dto.bizId}:${id}`,
      'compensation',
    );
  }
}
