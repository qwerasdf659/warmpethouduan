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
  /** 资产 code（`asset_def.code`） */
  assetCode: string;
  name: string;
  price: number;
  /** 计价货币资产 code（`game_coin` / `marketing_point`） */
  priceAsset: string;
  effect: ConsumableEffect;
  /** 背包持有份数 */
  owned: number;
  sortOrder: number;
}

export interface UseConsumableResult {
  assetCode: string;
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
 * 长期通胀只能靠这类项和扭蛋压住（见 `ledger/asset-seed.ts` 的定价口径）。
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
        assetCode: d.code,
        name: d.name,
        price: d.price,
        priceAsset: d.priceAsset,
        effect: table[d.code] ?? {},
        owned: owned.get(d.code) ?? 0,
        sortOrder: d.sortOrder,
      })),
      wallet,
    };
  }

  /** 购买消耗品（可一次买多份）。 */
  async buy(userId: string, assetCode: string, qty: number, bizId: string) {
    const def = await this.items.getDefByCode(assetCode);
    if (!def || def.itemType !== CONSUMABLE_TYPE) {
      throw new NotFoundException('消耗品不存在');
    }
    return this.items.buy(userId, assetCode, bizId, qty);
  }

  /**
   * 使用一份消耗品：先扣道具、再施加效果。
   *
   * 顺序刻意是「扣道具 → 加效果」而非反过来：反过来是**能白刷增益**的漏洞。
   * 而「扣了道具但效果没生效」是可自愈的：扣减以 `bizId` 落 `asset_txn` 持久幂等，
   * 客户端用同一个 bizId 重试会命中回放（不再扣第二份）并重新施加效果。
   * 这份保证不能退回只靠 Redis 去重——窗口一过，重试就会真的再扣一份。
   */
  async use(
    userId: string,
    assetCode: string,
    bizId: string,
    petId?: string,
  ): Promise<UseConsumableResult> {
    const def = await this.items.getDefByCode(assetCode);
    if (!def || def.itemType !== CONSUMABLE_TYPE) {
      throw new NotFoundException('消耗品不存在');
    }

    const table = await this.config.get('items.consumables');
    const effect = table[def.code];
    if (isEmptyEffect(effect)) {
      // 目录里加了消耗品但忘配效果：宁可拒绝，也不要扣掉道具什么都不发生
      throw new BadRequestException('该消耗品暂未配置效果，请联系客服');
    }

    return this.lock.withLock(`pet:${userId}`, async () => {
      // 扣减带持久幂等（bizId 落 asset_txn.biz_id），重复提交回放而不是再扣一份
      const left = await this.items.consumeOwned(userId, def.code, bizId, 1);

      const applied = await this.pet.applyConsumable(userId, effect, petId);
      return {
        assetCode: def.code,
        left,
        effect,
        pet: applied.pet,
        levelUp: applied.levelUp,
      };
    });
  }
}
