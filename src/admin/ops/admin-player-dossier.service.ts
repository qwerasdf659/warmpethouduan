import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { rowsOf } from '../../common/db/query-result';
import { Daily } from '../../entities/daily.entity';
import { DexClaim } from '../../entities/dex-claim.entity';
import { GachaState } from '../../entities/gacha-state.entity';
import { Pet } from '../../entities/pet.entity';
import { PetCondition } from '../../entities/pet-condition.entity';
import { PetEquip } from '../../entities/pet-equip.entity';
import { PetTrick } from '../../entities/pet-trick.entity';
import { User } from '../../entities/user.entity';
import { UserAddress } from '../../entities/user-address.entity';

/** 某只宠物的「主状态之外」的三块：病症 / 穿戴 / 技巧。 */
export interface PetExtraView {
  petId: string;
  conditions: {
    conditionKey: string;
    since: Date;
    curedAt: Date | null;
    curedBy: string | null;
  }[];
  equips: { slot: string; assetCode: string; updatedAt: Date }[];
  tricks: {
    trickKey: string;
    proficiency: number;
    learnedAt: Date;
    lastPracticeAt: Date | null;
  }[];
}

/** 玩家名下的唯一物品实例。 */
export interface PlayerInstanceView {
  id: string;
  assetCode: string;
  state: string;
  serial: number | null;
  acquiredAt: Date;
  tradableAfter: Date | null;
}

export interface PlayerDossier {
  /** 签到与每日任务；从未签到过的玩家没有这一行 */
  daily: Daily | null;
  dexClaims: DexClaim[];
  addresses: UserAddress[];
  gachaStates: GachaState[];
  petExtras: PetExtraView[];
  instances: PlayerInstanceView[];
}

/**
 * 玩家「玩法档案」：把散在各玩法域、后台此前完全查不到的玩家态聚合成一次查询。
 *
 * 为什么不并进 `/admin/players/:id`：那个接口是客服打开抽屉的第一屏，要快；
 * 而这里要扫七张表，其中大多数只有在处理具体申诉（断签、图鉴漏领、皮肤不见了、
 * 保底没给）时才会看。分开之后抽屉可以按 Tab 懒加载，不给最常见的路径加钱。
 */
@Injectable()
export class AdminPlayerDossierService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Pet) private readonly pets: Repository<Pet>,
    @InjectRepository(Daily) private readonly dailies: Repository<Daily>,
    @InjectRepository(DexClaim) private readonly dex: Repository<DexClaim>,
    @InjectRepository(UserAddress)
    private readonly addresses: Repository<UserAddress>,
    @InjectRepository(GachaState)
    private readonly gachaStates: Repository<GachaState>,
    @InjectRepository(PetCondition)
    private readonly conditions: Repository<PetCondition>,
    @InjectRepository(PetEquip) private readonly equips: Repository<PetEquip>,
    @InjectRepository(PetTrick) private readonly tricks: Repository<PetTrick>,
  ) {}

  async dossier(userId: string): Promise<PlayerDossier> {
    await this.assertUserExists(userId);

    const petIds = (
      await this.pets.find({ where: { userId }, select: { id: true } })
    ).map((p) => p.id);

    const [daily, dexClaims, addresses, gachaStates, instances, petExtras] =
      await Promise.all([
        this.dailies.findOne({ where: { userId } }),
        this.dex.find({ where: { userId }, order: { id: 'DESC' } }),
        this.addresses.find({
          where: { userId },
          order: { isDefault: 'DESC', id: 'DESC' },
        }),
        this.gachaStates.find({ where: { userId }, order: { poolKey: 'ASC' } }),
        this.instancesOf(userId),
        this.petExtrasOf(petIds),
      ]);

    return { daily, dexClaims, addresses, gachaStates, petExtras, instances };
  }

  /**
   * 玩家持有的唯一物品实例。
   *
   * 物品实例挂在 **account** 而不是 user 上，所以必须经 `account` 换算。
   * `burned` 是终态但行会保留，这里一并返回 —— 「我的限定皮肤没了」正需要
   * 看到它是被系统回收销毁了，还是正挂在市场上（listed/escrowed）。
   */
  private async instancesOf(userId: string): Promise<PlayerInstanceView[]> {
    const rows = rowsOf<{
      id: string;
      asset_code: string;
      state: string;
      serial: number | null;
      acquired_at: Date;
      tradable_after: Date | null;
    }>(
      await this.ds.query(
        `SELECT i."id", i."asset_code", i."state", i."serial",
                i."acquired_at", i."tradable_after"
           FROM "item_instance" i
           JOIN "account" a ON a."id" = i."owner_account_id"
          WHERE a."user_id" = $1
          ORDER BY i."id" DESC
          LIMIT 200`,
        [userId],
      ),
    );
    return rows.map((r) => ({
      id: r.id,
      assetCode: r.asset_code,
      state: r.state,
      serial: r.serial,
      acquiredAt: r.acquired_at,
      tradableAfter: r.tradable_after,
    }));
  }

  private async petExtrasOf(petIds: string[]): Promise<PetExtraView[]> {
    if (!petIds.length) return [];

    const [conditions, equips, tricks] = await Promise.all([
      // 只取未治愈的：已治愈的病症是历史，堆在抽屉里会淹掉「现在病着」这个结论
      this.conditions.find({
        where: { petId: In(petIds), curedAt: IsNull() },
        order: { since: 'ASC' },
      }),
      this.equips.find({
        where: { petId: In(petIds) },
        order: { slot: 'ASC' },
      }),
      this.tricks.find({
        where: { petId: In(petIds) },
        order: { proficiency: 'DESC' },
      }),
    ]);

    return petIds.map((petId) => ({
      petId,
      conditions: conditions
        .filter((c) => c.petId === petId)
        .map((c) => ({
          conditionKey: c.conditionKey,
          since: c.since,
          curedAt: c.curedAt,
          curedBy: c.curedBy,
        })),
      equips: equips
        .filter((e) => e.petId === petId)
        .map((e) => ({
          slot: e.slot,
          assetCode: e.assetCode,
          updatedAt: e.updatedAt,
        })),
      tricks: tricks
        .filter((t) => t.petId === petId)
        .map((t) => ({
          trickKey: t.trickKey,
          proficiency: t.proficiency,
          learnedAt: t.learnedAt,
          lastPracticeAt: t.lastPracticeAt,
        })),
    }));
  }

  private async assertUserExists(userId: string): Promise<void> {
    const exists = await this.users.exists({ where: { id: userId } });
    if (!exists) throw new NotFoundException('玩家不存在');
  }
}
