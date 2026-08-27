import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PlayerStatusService } from '../auth/player-status.service';
import { ClockService } from '../common/clock/clock.service';
import { LockService } from '../common/lock/lock.service';
import { GameConfigService } from '../config/game-config.service';
import { Pet } from '../entities/pet.entity';
import {
  buildPetTuning,
  levelOf,
  snapshot,
  stageIndexOf,
  toView,
  type PetStateView,
  type PetTuning,
} from '../pet/pet-math';
import type { FusionRecipe } from './fusion.config';

export interface FusionPreview {
  ok: boolean;
  reason?: string;
  resultForm?: string;
  resultRarity?: string;
  consumes?: { id: string; nickname: string | null }[];
  warning?: string;
}

@Injectable()
export class FusionService {
  constructor(
    @InjectRepository(Pet) private readonly pets: Repository<Pet>,
    private readonly config: GameConfigService,
    private readonly clock: ClockService,
    private readonly lock: LockService,
    private readonly playerStatus: PlayerStatusService,
  ) {}

  private async tuning(): Promise<PetTuning> {
    return buildPetTuning(await this.config.snapshot());
  }

  /** 校验材料并返回匹配的配方（不满足时返回原因）。 */
  private async validate(
    userId: string,
    petIds: string[],
    t: PetTuning,
  ): Promise<
    | { ok: false; reason: string }
    | { ok: true; recipe: FusionRecipe; pets: Pet[] }
  > {
    if (petIds.length === 0) return { ok: false, reason: '未选择材料' };
    const uniq = Array.from(new Set(petIds));
    if (uniq.length !== petIds.length) {
      return { ok: false, reason: '材料宠物重复' };
    }
    const pets = await this.pets.find({
      where: { id: In(petIds), userId, status: 'active' },
    });
    if (pets.length !== petIds.length) {
      return { ok: false, reason: '材料宠物不存在或已失效' };
    }
    if (pets.some((p) => p.isActive)) {
      return { ok: false, reason: '出战宠不能作为材料' };
    }
    const recipes = await this.config.get('fusion.recipes');
    const forms = new Set(pets.map((p) => p.form));
    if (forms.size > 1) return { ok: false, reason: '材料宠物形态不一致' };
    const form = pets[0].form;
    const recipe = recipes.find(
      (r) => r.from.form === form && r.from.count === pets.length,
    );
    if (!recipe) return { ok: false, reason: '没有匹配的融合配方' };
    if (recipe.from.sameSkin) {
      const skins = new Set(pets.map((p) => p.species));
      if (skins.size > 1) return { ok: false, reason: '材料宠物花色不一致' };
    }
    const requireIdx = Math.max(
      0,
      t.stages.findIndex((s) => s.key === recipe.from.requireStage),
    );
    for (const p of pets) {
      const lvl = levelOf(p.exp, t.growth).level;
      if (stageIndexOf(lvl, t.stages) < requireIdx) {
        return { ok: false, reason: '材料宠物未成年' };
      }
    }
    return { ok: true, recipe, pets };
  }

  async preview(userId: string, petIds: string[]): Promise<FusionPreview> {
    const t = await this.tuning();
    const v = await this.validate(userId, petIds, t);
    if (!v.ok) return { ok: false, reason: v.reason };
    return {
      ok: true,
      resultForm: v.recipe.to.form,
      resultRarity: v.recipe.to.rarity,
      consumes: v.pets.map((p) => ({ id: p.id, nickname: p.nickname })),
      warning: '材料宠物将被永久消耗且不可恢复',
    };
  }

  async execute(
    userId: string,
    bizId: string,
    petIds: string[],
  ): Promise<{ pet: PetStateView; duplicated: boolean }> {
    const t = await this.tuning();
    return this.lock.withLock(`pet:${userId}`, async () => {
      await this.playerStatus.assertNotBanned(userId);
      const v = await this.validate(userId, petIds, t);
      if (!v.ok) throw new BadRequestException(v.reason);

      // 载体：第一只升级为产物，其余软失效（保血统可追溯）
      const [carrier, ...materials] = v.pets;
      carrier.form = v.recipe.to.form;
      carrier.rarity = v.recipe.to.rarity;
      for (const m of materials) {
        m.status = 'fused';
        m.isActive = false;
      }
      const saved = await this.pets.save([carrier, ...materials]);
      const result = saved[0];
      void bizId;
      return { pet: toView(result, snapshot(result), t), duplicated: false };
    });
  }
}
