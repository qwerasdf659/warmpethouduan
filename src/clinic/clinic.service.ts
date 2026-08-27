import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClockService } from '../common/clock/clock.service';
import { LockService } from '../common/lock/lock.service';
import { GameConfigService } from '../config/game-config.service';
import { EconomyService, WalletView } from '../economy/economy.service';
import { Clinic } from '../entities/clinic.entity';
import { ClinicCase, ClinicOption } from '../entities/clinic-case.entity';
import { GAME_COIN } from '../ledger/ledger.types';
import { RewardService } from '../ledger/reward.service';

/** 诊所视图：星级由正确率派生，correct/total 供前端展示。 */
export interface ClinicView {
  star: number;
  correctCount: number;
  totalCount: number;
}

/**
 * 病例视图。
 *
 * ⚠ 显式挑字段（不用 `...spread`）：`answer_key` 落在实体上但**绝不下发**，
 * 否则客户端一改就无限刷币。`remainSec` 由服务端算，前端不得用本地时间判过期。
 */
export interface CaseView {
  id: string;
  symptoms: string[];
  options: ClinicOption[];
  expiresAt: string;
  remainSec: number;
}

/**
 * 兽医经营（P7）。
 *
 * 三个写路径都用 `lock.withLock('clinic:'+userId)` 串行化同一玩家的操作。
 * 收益一律经 `RewardService`（reason `clinic`），绝不裸改余额；时间一律取
 * `ClockService.now()`。`GET /clinic/case` 是读接口但会建行（领病例）——
 * 有意的例外，靠「已有 open 且未过期病例则直接返回」使重复调用天然幂等。
 */
@Injectable()
export class ClinicService {
  constructor(
    @InjectRepository(Clinic)
    private readonly clinics: Repository<Clinic>,
    @InjectRepository(ClinicCase)
    private readonly cases: Repository<ClinicCase>,
    private readonly reward: RewardService,
    private readonly economy: EconomyService,
    private readonly config: GameConfigService,
    private readonly lock: LockService,
    private readonly clock: ClockService,
  ) {}

  /** 解锁诊所：扣币后建行。已解锁再来（新 bizId）报 400。 */
  async unlock(
    userId: string,
    bizId: string,
  ): Promise<{ clinic: ClinicView; wallet: WalletView; duplicated: boolean }> {
    const cfg = await this.config.get('clinic.unlock');

    return this.lock.withLock(`clinic:${userId}`, async () => {
      const existing = await this.clinics.findOne({ where: { userId } });
      if (existing) throw new BadRequestException('诊所已解锁');

      // 扣费在建行之前：若扣完崩溃，重试（同 bizId）扣费幂等回放不重扣，
      // 建行仍会补上——不会留下「扣了钱没开诊所」的中间态。
      const charged = await this.reward.charge(
        userId,
        [{ assetCode: GAME_COIN, count: cfg.cost }],
        {
          reason: 'clinic',
          bizKey: `clinic:unlock:${bizId}`,
          refType: 'clinic',
        },
      );

      const clinic = await this.clinics.save(
        this.clinics.create({
          userId,
          star: 1,
          correctCount: 0,
          totalCount: 0,
        }),
      );

      return {
        clinic: this.toClinicView(clinic),
        wallet: await this.economy.getWallet(userId),
        duplicated: charged.duplicated,
      };
    });
  }

  /**
   * 领病例。读接口但会建行——已有未过期 open 病例直接返回（重复调用幂等），
   * 否则新建一例。诊所未解锁 400。
   */
  async getCase(userId: string): Promise<{ case: CaseView }> {
    return this.lock.withLock(`clinic:${userId}`, async () => {
      const clinic = await this.clinics.findOne({ where: { userId } });
      if (!clinic) throw new BadRequestException('诊所未解锁');

      const now = this.clock.now();
      const open = await this.cases.findOne({
        where: { userId, status: 'open' },
        order: { id: 'DESC' },
      });
      if (open) {
        if (open.expiresAt.getTime() > now.getTime()) {
          return { case: this.toCaseView(open, now) };
        }
        // 过期的 open 例先落 expired，避免下次又被取到当作有效病例
        open.status = 'expired';
        await this.cases.save(open);
      }

      const created = await this.cases.save(await this.buildCase(userId, now));
      return { case: this.toCaseView(created, now) };
    });
  }

  /** 接诊作答：判对错→发币→更新病例与诊所星级。 */
  async diagnose(
    userId: string,
    caseId: string,
    optionKey: string,
    bizId: string,
  ): Promise<{
    correct: boolean;
    rewardCoin: number;
    clinic: ClinicView;
    wallet: WalletView;
    duplicated: boolean;
  }> {
    return this.lock.withLock(`clinic:${userId}`, async () => {
      const clinic = await this.clinics.findOne({ where: { userId } });
      if (!clinic) throw new BadRequestException('诊所未解锁');

      const c = await this.cases.findOne({ where: { id: caseId, userId } });
      if (!c) throw new BadRequestException('病例不存在');

      if (c.status === 'answered') {
        // 同 bizId 重试：按已落库结果回放，绝不二次发奖
        if (c.bizId && c.bizId === bizId) {
          return this.diagnoseResult(
            userId,
            c.correct ?? false,
            c.rewardCoin,
            clinic,
            true,
          );
        }
        throw new BadRequestException('病例已作答');
      }

      const now = this.clock.now();
      if (c.expiresAt.getTime() <= now.getTime()) {
        c.status = 'expired';
        await this.cases.save(c);
        throw new BadRequestException('病例已过期');
      }

      const cfg = await this.config.get('clinic.reward');
      const correct = optionKey === c.answerKey;
      const rewardCoin = correct
        ? cfg.baseCoin * clinic.star
        : Math.floor(cfg.baseCoin * cfg.wrongRatio);

      // rewardCoin 为 0 时不记账：RewardService 对空奖励会抛错，且 0 分录无意义
      let duplicated = false;
      if (rewardCoin > 0) {
        const granted = await this.reward.grant(
          userId,
          [{ assetCode: GAME_COIN, count: rewardCoin }],
          {
            reason: 'clinic',
            bizKey: `clinic:diagnose:${bizId}`,
            refType: 'clinic_case',
            refId: c.id,
          },
        );
        duplicated = granted.duplicated;
      }

      c.status = 'answered';
      c.answeredKey = optionKey;
      c.correct = correct;
      c.rewardCoin = rewardCoin;
      c.bizId = bizId;
      await this.cases.save(c);

      clinic.totalCount += 1;
      if (correct) clinic.correctCount += 1;
      clinic.star = this.computeStar(
        clinic.correctCount,
        clinic.totalCount,
        cfg.starThresholds,
      );
      await this.clinics.save(clinic);

      return this.diagnoseResult(
        userId,
        correct,
        rewardCoin,
        clinic,
        duplicated,
      );
    });
  }

  // ---------------------------------------------------------------- 内部

  /** 从 pet.conditions 目录随机取一病症，拼症状与候选方案（含正确答案）。 */
  private async buildCase(userId: string, now: Date): Promise<ClinicCase> {
    const conditions = await this.config.get('pet.conditions');
    if (conditions.length === 0) {
      // 目录为空属于配置异常：接诊无从生成，明确报错而非造出无答案病例
      throw new BadRequestException('病症目录为空，暂无法接诊');
    }
    const cfg = await this.config.get('clinic.reward');

    const answer = conditions[Math.floor(Math.random() * conditions.length)];

    // 干扰项从其它病症里取，最多凑到 4 个候选，再整体打乱，避免答案恒在首位
    const distractors = this.shuffle(
      conditions.filter((cnd) => cnd.key !== answer.key),
    ).slice(0, 3);
    const options: ClinicOption[] = this.shuffle(
      [answer, ...distractors].map((cnd) => ({ key: cnd.key, name: cnd.name })),
    );

    const symptoms = this.symptomsOf(answer.desc, answer.name);
    const expiresAt = new Date(now.getTime() + cfg.caseTtlSec * 1000);

    return this.cases.create({
      userId,
      conditionKey: answer.key,
      symptoms,
      options,
      answerKey: answer.key,
      expiresAt,
      status: 'open',
      rewardCoin: 0,
    });
  }

  /** 把病症描述拆成症状短句；拆不出就退回病症名。 */
  private symptomsOf(desc: string, name: string): string[] {
    const parts = desc
      .split(/[，,、。；;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length > 0 ? parts : [name];
  }

  /** Fisher–Yates 洗牌（拷贝，不改原数组）。 */
  private shuffle<T>(arr: T[]): T[] {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /**
   * 星级 = 正确率达到的阈值个数（阈值升序），下限 1、上限即阈值数量。
   * 无作答记录时按 1 星。
   */
  private computeStar(
    correct: number,
    total: number,
    thresholds: number[],
  ): number {
    if (total <= 0 || thresholds.length === 0) return 1;
    const ratio = correct / total;
    const met = thresholds.reduce((n, t) => (ratio >= t ? n + 1 : n), 0);
    return Math.min(Math.max(met, 1), thresholds.length);
  }

  private async diagnoseResult(
    userId: string,
    correct: boolean,
    rewardCoin: number,
    clinic: Clinic,
    duplicated: boolean,
  ): Promise<{
    correct: boolean;
    rewardCoin: number;
    clinic: ClinicView;
    wallet: WalletView;
    duplicated: boolean;
  }> {
    return {
      correct,
      rewardCoin,
      clinic: this.toClinicView(clinic),
      wallet: await this.economy.getWallet(userId),
      duplicated,
    };
  }

  private toClinicView(clinic: Clinic): ClinicView {
    return {
      star: clinic.star,
      correctCount: clinic.correctCount,
      totalCount: clinic.totalCount,
    };
  }

  /** ⚠ 只挑安全字段：answerKey / answeredKey / correct 等绝不出现在这里。 */
  private toCaseView(c: ClinicCase, now: Date): CaseView {
    const remainMs = c.expiresAt.getTime() - now.getTime();
    return {
      id: c.id,
      symptoms: c.symptoms,
      options: c.options,
      expiresAt: c.expiresAt.toISOString(),
      remainSec: Math.max(0, Math.floor(remainMs / 1000)),
    };
  }
}
