import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GachaDraw } from '../../entities/gacha-draw.entity';
import { GachaState } from '../../entities/gacha-state.entity';
import {
  QueryGachaDrawsDto,
  QueryGachaStatesDto,
} from './dto/gameplay-query.dto';

/** 一抽的后台视图。prizes 原样下发：客服要核对的就是「到底出了什么」。 */
export interface GachaDrawView {
  id: string;
  userId: string;
  poolKey: string;
  times: number;
  cost: number;
  assetCode: string;
  prizes: GachaDraw['prizes'];
  /** 本次是否出了稀有奖励 —— 列表里最常被扫的一列 */
  rare: boolean;
  delivered: boolean;
  bizId: string;
  createdAt: Date;
}

/**
 * 扭蛋后台只读查询。
 *
 * 存在的理由是客服工单：「我抽了 80 次没出金」在此之前无法核对 —— 保底计数
 * 落在 `gacha_state`，产出落在 `gacha_draw`，两张表后台都没有入口，只能连库查。
 */
@Injectable()
export class AdminGachaService {
  constructor(
    @InjectRepository(GachaDraw)
    private readonly draws: Repository<GachaDraw>,
    @InjectRepository(GachaState)
    private readonly states: Repository<GachaState>,
  ) {}

  async drawList(
    q: QueryGachaDrawsDto,
  ): Promise<{ list: GachaDrawView[]; total: number }> {
    const qb = this.draws
      .createQueryBuilder('d')
      .orderBy('d.id', 'DESC')
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize);

    if (q.userId) qb.andWhere('d.userId = :uid', { uid: q.userId });
    if (q.poolKey) qb.andWhere('d.poolKey = :pk', { pk: q.poolKey });
    if (q.filter === 'rare') {
      // 稀有标记在 prizes 数组的元素里，不是独立列。用 jsonb 包含查询而不是
      // 取回全部再在内存里筛：后者会让分页 total 失真。
      qb.andWhere(`d.prizes @> '[{"rare": true}]'::jsonb`);
    }

    const [rows, total] = await qb.getManyAndCount();
    return { list: rows.map((r) => this.toDrawView(r)), total };
  }

  async stateList(
    q: QueryGachaStatesDto,
  ): Promise<{ list: GachaState[]; total: number }> {
    const qb = this.states
      .createQueryBuilder('s')
      // 保底计数越高越接近「该出了」，运营巡检时最想先看到这些
      .orderBy('s.pity', 'DESC')
      .addOrderBy('s.id', 'DESC')
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize);

    if (q.userId) qb.andWhere('s.userId = :uid', { uid: q.userId });
    if (q.poolKey) qb.andWhere('s.poolKey = :pk', { pk: q.poolKey });

    const [list, total] = await qb.getManyAndCount();
    return { list, total };
  }

  /** 某玩家在各池子的保底进度，用于玩家详情抽屉。 */
  async statesOfUser(userId: string): Promise<GachaState[]> {
    return this.states.find({ where: { userId }, order: { poolKey: 'ASC' } });
  }

  private toDrawView(d: GachaDraw): GachaDrawView {
    return {
      id: d.id,
      userId: d.userId,
      poolKey: d.poolKey,
      times: d.times,
      cost: d.cost,
      assetCode: d.assetCode,
      prizes: d.prizes,
      rare: (d.prizes ?? []).some((p) => p.rare),
      delivered: d.delivered,
      bizId: d.bizId,
      createdAt: d.createdAt,
    };
  }
}
