import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { GameConfigService } from '../config/game-config.service';
import { AssetDef } from '../entities/asset-def.entity';
import { Pet } from '../entities/pet.entity';
import { PetCondition } from '../entities/pet-condition.entity';
import { PetEquip } from '../entities/pet-equip.entity';
import { PetTrick } from '../entities/pet-trick.entity';

/**
 * 加成 / 减益聚合层（P1 病症 · P2 Petpet · P8 融合形态 · P13 技巧掌握 · P10 特质）。
 *
 * 存在意义：这五个来源都影响「收益与衰减」，若各写一套结算会互相打架且难以对账。
 * 统一聚合成一份 PetBonus（**加性倍率增量**），由 PetService / RaceService 在既有结算点消费。
 *
 * 红线：只聚合收益类与衰减类键，**绝不产出 speed/endurance 修正**（三围只由等级决定）。
 */
export interface PetBonus {
  /** 互动收益倍率增量 */
  feedGain: number;
  petGain: number;
  playGain: number;
  intimacyGain: number;
  expGain: number;
  /** 衰减倍率增量（正数=衰减更快） */
  hungerDecay: number;
  cleanDecay: number;
  moodDecay: number;
  staminaRecover: number;
  /** 离线时薪倍率增量 */
  offlineRate: number;
  /** 赛跑成绩倍率增量（正数=更快） */
  raceScore: number;
}

const ZERO: PetBonus = {
  feedGain: 0,
  petGain: 0,
  playGain: 0,
  intimacyGain: 0,
  expGain: 0,
  hungerDecay: 0,
  cleanDecay: 0,
  moodDecay: 0,
  staminaRecover: 0,
  offlineRate: 0,
  raceScore: 0,
};

@Injectable()
export class PetBonusService {
  constructor(
    @InjectRepository(Pet)
    private readonly pets: Repository<Pet>,
    @InjectRepository(PetCondition)
    private readonly conditions: Repository<PetCondition>,
    @InjectRepository(PetEquip)
    private readonly equips: Repository<PetEquip>,
    @InjectRepository(PetTrick)
    private readonly tricks: Repository<PetTrick>,
    @InjectRepository(AssetDef)
    private readonly defs: Repository<AssetDef>,
    private readonly config: GameConfigService,
  ) {}

  private add(acc: PetBonus, e: Partial<PetBonus> | undefined): void {
    if (!e) return;
    for (const k of Object.keys(ZERO) as (keyof PetBonus)[]) {
      const v = e[k];
      if (typeof v === 'number') acc[k] += v;
    }
  }

  /** 按 petId 聚合（供只有 petId 的调用方，如 RaceService）。宠物不存在时返回零加成。 */
  async bonusOfPetId(petId: string): Promise<PetBonus> {
    const pet = await this.pets.findOne({ where: { id: petId } });
    return pet ? this.bonusOf(pet) : { ...ZERO };
  }

  /**
   * 聚合某只宠物的全部加成/减益。传入 Pet 实体（已含 traits/form）以省一次查询。
   */
  async bonusOf(pet: Pet): Promise<PetBonus> {
    const acc: PetBonus = { ...ZERO };
    const c = await this.config.snapshot();

    // P10 特质
    const traitDefs = c['pet.traits'];
    for (const key of pet.traits ?? []) {
      this.add(acc, traitDefs.find((d) => d.key === key)?.effects);
    }

    // P1 活跃病症（只降收益）
    const activeConds = await this.conditions.find({
      where: { petId: pet.id, curedAt: IsNull() },
    });
    if (activeConds.length) {
      const condDefs = c['pet.conditions'];
      for (const row of activeConds) {
        this.add(
          acc,
          condDefs.find((d) => d.key === row.conditionKey)?.effects,
        );
      }
    }

    // P8 融合形态加成
    if (pet.form && pet.form !== 'normal') {
      this.add(acc, c['fusion.bonus'][pet.form]);
    }

    // P13 已掌握（满熟练度）的技巧加成
    const mastered = await this.tricks.find({ where: { petId: pet.id } });
    if (mastered.length) {
      const trickDefs = c['training.tricks'];
      for (const t of mastered) {
        if (t.proficiency < 100) continue;
        this.add(
          acc,
          trickDefs.find((d) => d.key === t.trickKey)?.masteryBonus,
        );
      }
    }

    // P2 已装备 Petpet / 其它带 bonus 的换装
    const equipped = await this.equips.find({ where: { petId: pet.id } });
    if (equipped.length) {
      const codes = equipped.map((e) => e.assetCode);
      const rows = await this.defs.find({
        where: codes.map((code) => ({ code })),
      });
      for (const r of rows) {
        const bonus = (r.meta as { bonus?: Partial<PetBonus> })?.bonus;
        this.add(acc, bonus);
      }
    }

    return acc;
  }
}
