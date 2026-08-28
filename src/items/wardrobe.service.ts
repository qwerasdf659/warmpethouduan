import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LockService } from '../common/lock/lock.service';
import { Pet } from '../entities/pet.entity';
import { PetEquip } from '../entities/pet-equip.entity';
import type { ItemType } from '../ledger/asset-catalog.service';
import { InventoryService } from '../ledger/inventory.service';
import { ItemsService } from './items.service';

const WARDROBE_TYPES: ItemType[] = ['skin', 'accessory', 'petpet'];

export interface WardrobeItemView {
  /** 资产 code（`asset_def.code`） */
  assetCode: string;
  type: string;
  name: string;
  slot: string | null;
  price: number;
  /** 计价货币资产 code（`game_coin` / `marketing_point`） */
  priceAsset: string;
  owned: boolean;
  equipped: boolean;
  /** 可交易（前端据此显示挂单入口） */
  tradable: boolean;
  /** 我持有的这件的限量编号（多件时取编号最小的一件） */
  serial: number | null;
}

export interface WardrobeView {
  petId: string | null;
  items: WardrobeItemView[];
  /** slot -> assetCode */
  equipped: Record<string, string>;
}

/** 换装：购买走 ItemsService，穿戴写 pet_equip（仅外观，不影响属性）。 */
@Injectable()
export class WardrobeService {
  constructor(
    @InjectRepository(PetEquip)
    private readonly equips: Repository<PetEquip>,
    @InjectRepository(Pet)
    private readonly pets: Repository<Pet>,
    private readonly items: ItemsService,
    private readonly inventory: InventoryService,
    private readonly lock: LockService,
  ) {}

  async list(userId: string, petId?: string): Promise<WardrobeView> {
    const pet = await this.resolvePet(userId, petId);
    const defs = await this.items.listDefsByType(WARDROBE_TYPES);
    const owned = await this.items.ownedMap(userId);
    const equipped = pet ? await this.equippedMap(pet.id) : {};
    const equippedKeys = new Set(Object.values(equipped));

    // 换装类是 unique 资产，持有形态是实例；编号要展示给玩家看（「第 7/100 件」）
    const instances = await this.inventory.listInstances(userId);
    const serialOf = new Map<string, number | null>();
    for (const inst of instances) {
      if (!serialOf.has(inst.assetCode)) {
        serialOf.set(inst.assetCode, inst.serial);
      }
    }

    return {
      petId: pet?.id ?? null,
      items: defs.map((d) => ({
        assetCode: d.code,
        type: d.itemType ?? '',
        name: d.name,
        slot: d.slot,
        price: d.price,
        priceAsset: d.priceAsset,
        // price=0 视为默认拥有（如原色皮肤、暖阳小屋背景）：它们不铸造实例，
        // 因此不能靠「有没有实例」判断，否则新玩家会发现自己连原色都没有
        owned: d.price === 0 || (owned.get(d.code) ?? 0) > 0,
        equipped: equippedKeys.has(d.code),
        tradable: d.tradable,
        serial: serialOf.get(d.code) ?? null,
      })),
      equipped,
    };
  }

  buy(userId: string, assetCode: string, bizId: string) {
    return this.items.buy(userId, assetCode, bizId);
  }

  /** 穿戴：校验拥有 + 归属，写 pet_equip(pet,slot)。 */
  async equip(
    userId: string,
    assetCode: string,
    petId?: string,
  ): Promise<WardrobeView> {
    const def = await this.items.getDefByCode(assetCode);
    if (!def || !def.enabled) throw new NotFoundException('物品不存在或已下架');
    const slot = def.slot;
    if (!def.itemType || !WARDROBE_TYPES.includes(def.itemType) || !slot) {
      throw new BadRequestException('该物品不可穿戴');
    }

    return this.lock.withLock(`pet:${userId}`, async () => {
      const pet = await this.resolvePet(userId, petId);
      if (!pet) throw new NotFoundException('没有可穿戴的宠物');

      const owned = await this.items.ownedMap(userId);
      if (def.price > 0 && (owned.get(def.code) ?? 0) <= 0) {
        // 挂单中的实例归 ESCROW 持有，不计入 ownedMap ——「边穿边卖」因此不可能
        throw new BadRequestException('尚未拥有该物品（或该物品正在挂单中）');
      }

      const existing = await this.equips.findOne({
        where: { petId: pet.id, slot },
      });
      if (existing) {
        existing.assetCode = def.code;
        await this.equips.save(existing);
      } else {
        await this.equips.save(
          this.equips.create({
            userId,
            petId: pet.id,
            slot,
            assetCode: def.code,
          }),
        );
      }
      return this.list(userId, pet.id);
    });
  }

  /** 卸下某槽位。 */
  async unequip(
    userId: string,
    slot: string,
    petId?: string,
  ): Promise<WardrobeView> {
    return this.lock.withLock(`pet:${userId}`, async () => {
      const pet = await this.resolvePet(userId, petId);
      if (!pet) throw new NotFoundException('没有宠物');
      await this.equips.delete({ petId: pet.id, slot });
      return this.list(userId, pet.id);
    });
  }

  // ---------------------------------------------------------------- 内部

  private async resolvePet(
    userId: string,
    petId?: string,
  ): Promise<Pet | null> {
    if (petId) {
      const found = await this.pets.findOne({ where: { id: petId, userId } });
      if (!found) throw new NotFoundException('宠物不存在');
      return found;
    }
    return (
      (await this.pets.findOne({ where: { userId, isActive: true } })) ??
      (await this.pets.findOne({ where: { userId }, order: { id: 'ASC' } }))
    );
  }

  /** 返回 pet 当前穿戴 slot -> assetCode。 */
  private async equippedMap(petId: string): Promise<Record<string, string>> {
    const rows = await this.equips.find({ where: { petId } });
    const out: Record<string, string> = {};
    for (const r of rows) out[r.slot] = r.assetCode;
    return out;
  }
}
