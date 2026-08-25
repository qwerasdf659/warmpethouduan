import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LockService } from '../common/lock/lock.service';
import { ItemDef } from '../entities/item-def.entity';
import { Pet } from '../entities/pet.entity';
import { PetEquip } from '../entities/pet-equip.entity';
import { ItemsService } from './items.service';

const WARDROBE_TYPES = ['skin', 'accessory'];

export interface WardrobeItemView {
  key: string;
  type: string;
  name: string;
  slot: string | null;
  price: number;
  pool: string;
  owned: boolean;
  equipped: boolean;
}

export interface WardrobeView {
  petId: string | null;
  items: WardrobeItemView[];
  /** slot -> itemKey */
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
    @InjectRepository(ItemDef)
    private readonly defs: Repository<ItemDef>,
    private readonly items: ItemsService,
    private readonly lock: LockService,
  ) {}

  async list(userId: string, petId?: string): Promise<WardrobeView> {
    const pet = await this.resolvePet(userId, petId);
    const defs = await this.items.listDefsByType(WARDROBE_TYPES);
    const ownedIds = await this.items.ownedMap(userId);
    const equipped = pet ? await this.equippedMap(pet.id) : {};
    const equippedKeys = new Set(Object.values(equipped));

    return {
      petId: pet?.id ?? null,
      items: defs.map((d) => ({
        key: d.key,
        type: d.type,
        name: d.name,
        slot: d.slot,
        price: d.price,
        pool: d.pool,
        // price=0 视为默认拥有（如原色皮肤）
        owned: d.price === 0 || ownedIds.has(d.id),
        equipped: equippedKeys.has(d.key),
      })),
      equipped,
    };
  }

  buy(userId: string, itemKey: string, bizId: string) {
    return this.items.buy(userId, itemKey, bizId);
  }

  /** 穿戴：校验拥有 + 归属，写 pet_equip(pet,slot)。 */
  async equip(
    userId: string,
    itemKey: string,
    petId?: string,
  ): Promise<WardrobeView> {
    const def = await this.items.getDefByKey(itemKey);
    if (!def || !def.enabled) throw new NotFoundException('物品不存在或已下架');
    const slot = def.slot;
    if (!WARDROBE_TYPES.includes(def.type) || !slot) {
      throw new BadRequestException('该物品不可穿戴');
    }

    return this.lock.withLock(`pet:${userId}`, async () => {
      const pet = await this.resolvePet(userId, petId);
      if (!pet) throw new NotFoundException('没有可穿戴的宠物');

      const ownedIds = await this.items.ownedMap(userId);
      if (def.price > 0 && !ownedIds.has(def.id)) {
        throw new BadRequestException('尚未拥有该物品');
      }

      const existing = await this.equips.findOne({
        where: { petId: pet.id, slot },
      });
      if (existing) {
        existing.itemDefId = def.id;
        await this.equips.save(existing);
      } else {
        await this.equips.save(
          this.equips.create({
            userId,
            petId: pet.id,
            slot,
            itemDefId: def.id,
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

  /** 返回 pet 当前穿戴 slot -> itemKey。 */
  private async equippedMap(petId: string): Promise<Record<string, string>> {
    const rows = await this.equips.find({ where: { petId } });
    if (rows.length === 0) return {};
    const defs = await this.defs.find({
      where: { id: In(rows.map((r) => r.itemDefId)) },
    });
    const idToKey = new Map(defs.map((d) => [d.id, d.key]));
    const out: Record<string, string> = {};
    for (const r of rows) {
      const key = idToKey.get(r.itemDefId);
      if (key) out[r.slot] = key;
    }
    return out;
  }
}
