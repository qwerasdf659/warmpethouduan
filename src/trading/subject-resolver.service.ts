import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClockService } from '../common/clock/clock.service';
import {
  AssetCatalogService,
  AssetView,
} from '../ledger/asset-catalog.service';
import { InventoryService } from '../ledger/inventory.service';
import type { ResolvedSubject, Subject } from './trading.types';

/**
 * 交易标的解析：校验归属、状态、冷却与可交易性。
 *
 * 独立成服务而不是留在某个玩法域里，是因为**每条玩家间流转路径都必须过同一套闸**。
 * 市场（挂单/赠送/回收）与易货各自实现一份的话，两份迟早会漂移，
 * 而漂移的方向永远是「新加的那条路径漏了某项校验」—— 易货绕过 `tradable`
 * 就是这么来的：`ck_asset_no_trade_gacha` 想堵的开箱变现通道，
 * 在市场侧被 `requireDef` 挡住，在易货侧却整条敞开。
 */
@Injectable()
export class SubjectResolverService {
  constructor(
    private readonly catalog: AssetCatalogService,
    private readonly inventory: InventoryService,
    private readonly clock: ClockService,
  ) {}

  /**
   * 解析并校验一件标的归属于 `userId`。
   *
   * `requireTradable` 对系统回收是 false：不可交易的扭蛋限定款仍然可以卖给系统 ——
   * 回收没有对手方，不构成玩家间流转，因此不触及「开箱变现」那条红线。
   * 凡是**有对手方**的路径（挂单、赠送、易货）必须传 true。
   */
  async resolve(
    userId: string,
    subject: Subject,
    opts: { requireTradable: boolean },
  ): Promise<ResolvedSubject> {
    if ('instanceId' in subject) {
      const instances = await this.inventory.listInstances(userId);
      const inst = instances.find((i) => i.instanceId === subject.instanceId);
      if (!inst) throw new NotFoundException('物品不存在或不属于你');
      if (inst.state !== 'held') {
        throw new BadRequestException('该物品正在挂单中');
      }
      // R2：获得后冷却。防盗号者即刻套现 —— 盗号的价值全在「立刻出手」
      if (
        inst.tradableAfter &&
        new Date(inst.tradableAfter) > this.clock.now()
      ) {
        throw new BadRequestException(
          `该物品需在 ${new Date(inst.tradableAfter).toLocaleString('zh-CN')} 后才可交易`,
        );
      }
      const def = await this.requireDef(inst.assetCode, opts.requireTradable);
      return {
        def,
        assetCode: def.code,
        qty: null,
        instanceId: inst.instanceId,
        referenceValue: def.price,
      };
    }

    const qty = Math.trunc(subject.qty);
    if (!Number.isSafeInteger(qty) || qty <= 0) {
      throw new BadRequestException('件数必须为正整数');
    }
    const def = await this.requireDef(subject.assetCode, opts.requireTradable);
    if (def.kind === 'unique') {
      throw new BadRequestException('唯一物品需按实例交易，请指定 instanceId');
    }
    const owned = await this.inventory.ownedQty(userId, def.code);
    if (owned < qty) throw new BadRequestException('持有数量不足');

    return {
      def,
      assetCode: def.code,
      qty,
      instanceId: null,
      referenceValue: def.price * qty,
    };
  }

  async requireDef(
    assetCode: string,
    requireTradable: boolean,
  ): Promise<AssetView> {
    const def = await this.catalog.getByCode(assetCode);
    if (!def) throw new NotFoundException('资产不存在');
    if (def.kind === 'currency') {
      // 货币不作为交易标的：它是**计价物**。允许「用币买币」就等于开了汇兑市场，
      // 而双池物理隔离的全部意义就是不存在汇率
      throw new BadRequestException('货币不能作为交易标的');
    }
    if (requireTradable && !def.tradable) {
      throw new BadRequestException(`${def.name} 不可交易`);
    }
    return def;
  }
}
