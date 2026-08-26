import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LockService } from '../common/lock/lock.service';
import { GameConfigService } from '../config/game-config.service';
import { EconomyService, WalletView } from '../economy/economy.service';
import type { PetStateView } from '../pet/pet-math';
import { PetService } from '../pet/pet.service';
import { ConsumableEffect, isEmptyEffect } from './items.config';
import { ItemsService } from './items.service';

const CONSUMABLE_TYPE = 'consumable';

export interface ConsumableItemView {
  key: string;
  name: string;
  price: number;
  pool: string;
  effect: ConsumableEffect;
  /** 背包持有份数 */
  owned: number;
  sortOrder: number;
}

export interface UseConsumableResult {
  itemKey: string;
  /** 使用后剩余份数 */
  left: number;
  effect: ConsumableEffect;
  pet: PetStateView;
  levelUp: boolean;
}

/**
 * 消耗品：目录、购买、使用。
 *
 * 独立于 `ItemsService` 是为了不把「宠物」耦合进物品域的公共服务 ——
 * `ItemsService` 被后台、兑换、图鉴、家园共用，它们都不需要知道 `PetService`。
 *
 * 消耗品在经济里的定位是**可重复消耗的 sink**：收藏品买断后就不再吸币，
 * 长期通胀只能靠这类项和扭蛋压住（见 `item-seed.ts` 的定价口径）。
 */
@Injectable()
export class ConsumableService {
  constructor(
    private readonly items: ItemsService,
    private readonly pet: PetService,
    private readonly economy: EconomyService,
    private readonly config: GameConfigService,
    private readonly lock: LockService,
  ) {}

  /** 消耗品商店：目录 + 效果 + 我的持有量 + 余额。 */
  async list(userId: string): Promise<{
    items: ConsumableItemView[];
    wallet: WalletView;
  }> {
    const [defs, table, owned, wallet] = await Promise.all([
      this.items.listDefsByType([CONSUMABLE_TYPE]),
      this.config.get('items.consumables'),
      this.items.ownedMap(userId),
      this.economy.getWallet(userId),
    ]);

    return {
      items: defs.map((d) => ({
        key: d.key,
        name: d.name,
        price: d.price,
        pool: d.pool,
        effect: table[d.key] ?? {},
        owned: owned.get(d.id) ?? 0,
        sortOrder: d.sortOrder,
      })),
      wallet,
    };
  }

  /** 购买消耗品（可一次买多份）。 */
  async buy(userId: string, itemKey: string, qty: number, bizId: string) {
    const def = await this.items.getDefByKey(itemKey);
    if (!def || def.type !== CONSUMABLE_TYPE) {
      throw new NotFoundException('消耗品不存在');
    }
    return this.items.buy(userId, itemKey, bizId, qty);
  }

  /**
   * 使用一份消耗品：先扣道具、再施加效果。
   *
   * 顺序刻意是「扣道具 → 加效果」而非反过来：效果施加失败（如没有宠物）时
   * 道具已经扣掉是可修复的（客服补发），但反过来是**能白刷增益**的漏洞。
   * 扣减用条件 UPDATE 保证并发下不会一份用两次。
   */
  async use(
    userId: string,
    itemKey: string,
    petId?: string,
  ): Promise<UseConsumableResult> {
    const def = await this.items.getDefByKey(itemKey);
    if (!def || def.type !== CONSUMABLE_TYPE) {
      throw new NotFoundException('消耗品不存在');
    }

    const table = await this.config.get('items.consumables');
    const effect = table[def.key];
    if (isEmptyEffect(effect)) {
      // 目录里加了消耗品但忘配效果：宁可拒绝，也不要扣掉道具什么都不发生
      throw new BadRequestException('该消耗品暂未配置效果，请联系客服');
    }

    return this.lock.withLock(`pet:${userId}`, async () => {
      const left = await this.items.consumeOwned(userId, def.id, 1);
      if (left === null) throw new BadRequestException('该消耗品数量不足');

      const applied = await this.pet.applyConsumable(userId, effect, petId);
      return {
        itemKey: def.key,
        left,
        effect,
        pet: applied.pet,
        levelUp: applied.levelUp,
      };
    });
  }
}
