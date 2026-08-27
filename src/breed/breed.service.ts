import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlayerStatusService } from '../auth/player-status.service';
import { AdTokenService } from '../boost/ad-token.service';
import { ClockService } from '../common/clock/clock.service';
import { LockService } from '../common/lock/lock.service';
import { GameConfigService } from '../config/game-config.service';
import { EconomyService, WalletView } from '../economy/economy.service';
import { Pet } from '../entities/pet.entity';
import { PetEgg } from '../entities/pet-egg.entity';
import { HomeComfortService } from '../home/home-comfort.service';
import { GAME_COIN } from '../ledger/ledger.types';
import { RewardService } from '../ledger/reward.service';
import {
  buildPetTuning,
  levelOf,
  snapshot,
  spendStamina,
  stageIndexOf,
  staminaMaxOf,
  toView,
  type PetStateView,
  type PetTuning,
} from '../pet/pet-math';

export interface EggView {
  id: string;
  hatchAt: string;
  remainSec: number;
  status: string;
  parentAId: string;
  parentBId: string;
}

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

@Injectable()
export class BreedService {
  constructor(
    @InjectRepository(Pet) private readonly pets: Repository<Pet>,
    @InjectRepository(PetEgg) private readonly eggs: Repository<PetEgg>,
    private readonly reward: RewardService,
    private readonly economy: EconomyService,
    private readonly config: GameConfigService,
    private readonly clock: ClockService,
    private readonly lock: LockService,
    private readonly playerStatus: PlayerStatusService,
    private readonly homeComfort: HomeComfortService,
    private readonly adToken: AdTokenService,
  ) {}

  private async tuning(): Promise<PetTuning> {
    return buildPetTuning(await this.config.snapshot());
  }

  private eggView(e: PetEgg, now: Date): EggView {
    return {
      id: e.id,
      hatchAt: new Date(e.hatchAt).toISOString(),
      remainSec: Math.max(
        0,
        Math.floor((new Date(e.hatchAt).getTime() - now.getTime()) / 1000),
      ),
      status: e.status,
      parentAId: e.parentAId,
      parentBId: e.parentBId,
    };
  }

  private async spendStamina(pet: Pet, t: PetTuning, cost: number, now: Date) {
    const comfort = await this.homeComfort.comfortOf(pet.userId);
    if (!spendStamina(pet, t, cost, now, comfort)) {
      throw new BadRequestException('体力不足');
    }
  }

  // ---------------------------------------------------------------- start

  async start(userId: string, bizId: string, petAId: string, petBId: string) {
    if (petAId === petBId) throw new BadRequestException('不能与自己繁殖');
    const t = await this.tuning();
    const rules = await this.config.get('breed.rules');
    const genesCfg = await this.config.get('breed.genes');
    const inherit = await this.config.get('breed.inherit');

    return this.lock.withLock(`pet:${userId}`, async () => {
      await this.playerStatus.assertNotBanned(userId);
      const now = this.clock.now();

      // 幂等：同 bizId 已产蛋则回放
      const existing = await this.eggs.findOne({ where: { userId, bizId } });
      if (existing) {
        const [a, b] = await Promise.all([
          this.pets.findOne({ where: { id: existing.parentAId, userId } }),
          this.pets.findOne({ where: { id: existing.parentBId, userId } }),
        ]);
        return {
          egg: this.eggView(existing, now),
          pets: [a, b]
            .filter((p): p is Pet => !!p)
            .map((p) => toView(p, snapshot(p), t)),
          wallet: await this.economy.getWallet(userId),
          duplicated: true,
        };
      }

      const petA = await this.pets.findOne({
        where: { id: petAId, userId, status: 'active' },
      });
      const petB = await this.pets.findOne({
        where: { id: petBId, userId, status: 'active' },
      });
      if (!petA || !petB) throw new NotFoundException('宠物不存在');

      const requireIdx = Math.max(
        0,
        t.stages.findIndex((s) => s.key === rules.requireStage),
      );
      for (const p of [petA, petB]) {
        const lvl = levelOf(p.exp, t.growth).level;
        if (stageIndexOf(lvl, t.stages) < requireIdx) {
          throw new BadRequestException('宠物未成年');
        }
        if (p.breedCooldownUntil && new Date(p.breedCooldownUntil) > now) {
          throw new BadRequestException('宠物繁殖冷却中');
        }
      }

      // 扣币（原子），再扣体力
      const res = await this.reward.charge(
        userId,
        [{ assetCode: GAME_COIN, count: rules.costCoin }],
        { reason: 'breed', bizKey: `${bizId}:breed` },
      );
      await this.spendStamina(petA, t, rules.staminaCost, now);
      await this.spendStamina(petB, t, rules.staminaCost, now);
      const cooldownUntil = new Date(
        now.getTime() + rules.cooldownHours * 3_600_000,
      );
      petA.breedCooldownUntil = cooldownUntil;
      petB.breedCooldownUntil = cooldownUntil;
      const [savedA, savedB] = await this.pets.save([petA, petB]);

      // 遗传：产蛋时定死（幂等可重放）
      const genesA = petA.genes?.length ? petA.genes : ['skin_default'];
      const genesB = petB.genes?.length ? petB.genes : ['skin_default'];
      const childGenes = [pick(genesA), pick(genesB)];
      // 显性花色：childGenes 中在 dominance 顺序里最靠前者（越靠前越显性）→ 决定孵化宠外观
      const dominance = genesCfg.dominance;
      const domIdx = (g: string) => {
        const i = dominance.indexOf(g);
        return i === -1 ? Number.MAX_SAFE_INTEGER : i;
      };
      const dominantGene =
        [...childGenes].sort((a, b) => domIdx(a) - domIdx(b))[0] ??
        petA.species;
      const traitPool = Array.from(
        new Set([...(petA.traits ?? []), ...(petB.traits ?? [])]),
      );
      const childTraits = traitPool.filter(
        () => Math.random() < inherit.traitInheritRate,
      );

      const egg = await this.eggs.save(
        this.eggs.create({
          userId,
          parentAId: petA.id,
          parentBId: petB.id,
          // 孵化宠的花色由显性基因决定（而非直接取父方）
          species: dominantGene,
          genes: childGenes,
          traits: childTraits,
          staminaBonusBps: Math.min(
            inherit.staminaBonusBps,
            inherit.staminaBonusCapBps,
          ),
          hatchAt: new Date(now.getTime() + rules.hatchHours * 3_600_000),
          status: 'incubating',
          bizId,
        }),
      );

      return {
        egg: this.eggView(egg, now),
        pets: [
          toView(savedA, snapshot(savedA), t),
          toView(savedB, snapshot(savedB), t),
        ],
        wallet: await this.economy.getWallet(userId),
        duplicated: res.duplicated,
      };
    });
  }

  // ---------------------------------------------------------------- list

  async listEggs(userId: string, page: number, pageSize: number) {
    const now = this.clock.now();
    const [rows, total] = await this.eggs.findAndCount({
      where: { userId },
      order: { id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { list: rows.map((e) => this.eggView(e, now)), total };
  }

  // ---------------------------------------------------------------- speedup

  async speedup(
    userId: string,
    bizId: string,
    eggId: string,
    method: 'ad' | 'coin',
    adTokenNonce?: string,
  ): Promise<{ egg: EggView; wallet: WalletView; duplicated: boolean }> {
    const speed = await this.config.get('breed.speedup');
    return this.lock.withLock(`pet:${userId}`, async () => {
      const now = this.clock.now();
      const egg = await this.eggs.findOne({
        where: { id: eggId, userId, status: 'incubating' },
      });
      if (!egg) throw new NotFoundException('蛋不存在或已孵化');

      let duplicated = false;
      let cutHours: number;
      if (method === 'coin') {
        const res = await this.reward.charge(
          userId,
          [{ assetCode: GAME_COIN, count: speed.coinPerHour }],
          { reason: 'breed', bizKey: `${bizId}:speedup` },
        );
        duplicated = res.duplicated;
        cutHours = 1;
      } else {
        if (!speed.adEnabled) throw new BadRequestException('孵化加速暂未开放');
        if (!adTokenNonce) throw new BadRequestException('缺少广告凭证');
        await this.adToken.consume(userId, adTokenNonce, 'breed_speedup');
        cutHours = speed.adHours;
      }

      const next = new Date(
        Math.max(
          now.getTime(),
          new Date(egg.hatchAt).getTime() - cutHours * 3_600_000,
        ),
      );
      egg.hatchAt = next;
      const saved = await this.eggs.save(egg);
      return {
        egg: this.eggView(saved, now),
        wallet: await this.economy.getWallet(userId),
        duplicated,
      };
    });
  }

  // ---------------------------------------------------------------- hatch

  async hatch(
    userId: string,
    bizId: string,
    eggId: string,
  ): Promise<{ pet: PetStateView; wallet: WalletView; duplicated: boolean }> {
    const t = await this.tuning();
    return this.lock.withLock(`pet:${userId}`, async () => {
      await this.playerStatus.assertNotBanned(userId);
      const now = this.clock.now();
      const egg = await this.eggs.findOne({ where: { id: eggId, userId } });
      if (!egg) throw new NotFoundException('蛋不存在');

      // 幂等：已孵化则回放已生成的宠
      if (egg.status === 'hatched' && egg.hatchedPetId) {
        const born = await this.pets.findOne({
          where: { id: egg.hatchedPetId, userId },
        });
        if (born) {
          return {
            pet: toView(born, snapshot(born), t),
            wallet: await this.economy.getWallet(userId),
            duplicated: true,
          };
        }
      }
      if (egg.status !== 'incubating') {
        throw new BadRequestException('该蛋不可孵化');
      }
      if (new Date(egg.hatchAt) > now) {
        throw new BadRequestException('尚未到孵化时间');
      }
      const count = await this.pets.count({
        where: { userId, status: 'active' },
      });
      if (count >= t.maxPets) {
        throw new BadRequestException(`最多只能养 ${t.maxPets} 只宠物`);
      }

      const born = await this.pets.save(
        this.pets.create({
          userId,
          nickname: null,
          species: egg.species,
          isActive: false,
          hunger: 80,
          mood: 80,
          cleanliness: 80,
          // 继承体力上限加成：初始体力按加成后的上限灌满
          stamina: staminaMaxOf(1, t.attrs, egg.staminaBonusBps ?? 0),
          intimacy: 0,
          level: 1,
          exp: 0,
          genes: egg.genes,
          traits: egg.traits,
          staminaBonusBps: egg.staminaBonusBps ?? 0,
          lastSeenAt: now,
        }),
      );
      egg.status = 'hatched';
      egg.hatchedPetId = born.id;
      await this.eggs.save(egg);

      return {
        pet: toView(born, snapshot(born), t),
        wallet: await this.economy.getWallet(userId),
        duplicated: false,
      };
    });
  }
}
