import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Clinic } from '../../entities/clinic.entity';
import { ClinicCase } from '../../entities/clinic-case.entity';
import { MinigameSession } from '../../entities/minigame-session.entity';
import { PetEgg } from '../../entities/pet-egg.entity';
import { PvpMatch } from '../../entities/pvp-match.entity';
import { PvpRank } from '../../entities/pvp-rank.entity';

interface Page {
  page: number;
  pageSize: number;
}

/**
 * 玩法扩展后台只读查询（P3/P4/P7/P11）。
 * 均为运营巡检用的分页列表；不含任何写操作，故不落审计。
 * clinic_case 出参**显式挑字段**，绝不下发 answer_key。
 */
@Injectable()
export class AdminPlayExpService {
  constructor(
    @InjectRepository(PetEgg) private readonly eggs: Repository<PetEgg>,
    @InjectRepository(PvpRank) private readonly ranks: Repository<PvpRank>,
    @InjectRepository(PvpMatch) private readonly matches: Repository<PvpMatch>,
    @InjectRepository(Clinic) private readonly clinics: Repository<Clinic>,
    @InjectRepository(ClinicCase)
    private readonly cases: Repository<ClinicCase>,
    @InjectRepository(MinigameSession)
    private readonly sessions: Repository<MinigameSession>,
  ) {}

  async eggList(q: Page) {
    const [list, total] = await this.eggs.findAndCount({
      order: { id: 'DESC' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    });
    return { list, total };
  }

  async pvpRankList(q: Page) {
    const [list, total] = await this.ranks.findAndCount({
      order: { rankPoint: 'DESC' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    });
    return { list, total };
  }

  async pvpMatchList(q: Page) {
    const [list, total] = await this.matches.findAndCount({
      order: { id: 'DESC' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    });
    return { list, total };
  }

  async clinicList(q: Page) {
    const [list, total] = await this.clinics.findAndCount({
      order: { star: 'DESC' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    });
    return { list, total };
  }

  async clinicCaseList(q: Page) {
    const [rows, total] = await this.cases.findAndCount({
      order: { id: 'DESC' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    });
    // 显式挑字段：answer_key 绝不出现在出参
    const list = rows.map((c) => ({
      id: c.id,
      userId: c.userId,
      conditionKey: c.conditionKey,
      status: c.status,
      answeredKey: c.answeredKey,
      correct: c.correct,
      rewardCoin: c.rewardCoin,
      expiresAt: c.expiresAt,
      createdAt: c.createdAt,
    }));
    return { list, total };
  }

  async minigameSessionList(q: Page) {
    const [list, total] = await this.sessions.findAndCount({
      order: { id: 'DESC' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    });
    return { list, total };
  }
}
