import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LockService } from '../common/lock/lock.service';
import { GameConfigService } from '../config/game-config.service';
import { comfortFactorOf } from '../pet/pet.config';
import { ItemDef } from '../entities/item-def.entity';
import { HomeLayout } from '../entities/home-layout.entity';
import { HomeComfortService } from './home-comfort.service';
import { ItemsService } from '../items/items.service';
import {
  HomeGrid,
  Rect,
  findFreeSpot,
  insideGrid,
  overlaps,
} from './home.config';

const HOME_TYPES = ['furniture'];

export interface PlacedView {
  layoutId: string;
  itemKey: string;
  name: string;
  comfort: number;
  posX: number;
  posY: number;
  /** 占格宽高，前端按此渲染并做拖拽吸附 */
  gridW: number;
  gridH: number;
}

export interface HomeView {
  comfort: number;
  comfortFactor: number;
  /** 房间网格尺寸，摆放坐标必须落在其中 */
  grid: HomeGrid;
  items: {
    key: string;
    name: string;
    price: number;
    pool: string;
    comfort: number;
    owned: number;
    placed: number;
    gridW: number;
    gridH: number;
  }[];
  placed: PlacedView[];
}

/**
 * 家园：家具购买（走 ItemsService）+ 摆放/收纳。舒适度不落快照，
 * 由 HomeComfortService 从已摆放家具实时聚合；comfort 决定宠物心情衰减减免
 * comfortFactor（PetService 读同一个口径）。
 */
@Injectable()
export class HomeService {
  constructor(
    @InjectRepository(HomeLayout)
    private readonly layouts: Repository<HomeLayout>,
    @InjectRepository(ItemDef)
    private readonly defs: Repository<ItemDef>,
    private readonly items: ItemsService,
    private readonly lock: LockService,
    private readonly config: GameConfigService,
    private readonly comfortOf: HomeComfortService,
  ) {}

  async getHome(userId: string): Promise<HomeView> {
    const defs = await this.items.listDefsByType(HOME_TYPES);
    const ownedIds = await this.items.ownedMap(userId);
    const layouts = await this.layouts.find({
      where: { userId },
      order: { id: 'ASC' },
    });
    const comfort = await this.comfortOf.comfortOf(userId);

    const placedCount = new Map<string, number>();
    for (const l of layouts) {
      placedCount.set(l.itemDefId, (placedCount.get(l.itemDefId) ?? 0) + 1);
    }
    const idToDef = new Map(defs.map((d) => [d.id, d]));
    // 摆放里可能包含已下架家具，补查一次
    const missingIds = layouts
      .map((l) => l.itemDefId)
      .filter((id) => !idToDef.has(id));
    if (missingIds.length > 0) {
      const extra = await this.defs.find({ where: { id: In(missingIds) } });
      for (const d of extra) idToDef.set(d.id, d);
    }

    return {
      comfort,
      comfortFactor: comfortFactorOf(
        comfort,
        await this.config.get('pet.comfort'),
      ),
      grid: await this.config.get('home.grid'),
      items: defs.map((d) => ({
        key: d.key,
        name: d.name,
        price: d.price,
        pool: d.pool,
        comfort: d.comfort,
        owned: ownedIds.get(d.id) ?? 0,
        placed: placedCount.get(d.id) ?? 0,
        gridW: d.gridW,
        gridH: d.gridH,
      })),
      placed: layouts.map((l) => {
        const d = idToDef.get(l.itemDefId);
        return {
          layoutId: l.id,
          itemKey: d?.key ?? '',
          name: d?.name ?? '',
          comfort: d?.comfort ?? 0,
          posX: l.posX,
          posY: l.posY,
          gridW: d?.gridW ?? 1,
          gridH: d?.gridH ?? 1,
        };
      }),
    };
  }

  /** 购买家具（仅限 furniture 类型）。 */
  async buy(userId: string, itemKey: string, bizId: string) {
    const def = await this.items.getDefByKey(itemKey);
    if (!def || def.type !== 'furniture') {
      throw new BadRequestException('该物品不是家具');
    }
    return this.items.buy(userId, itemKey, bizId);
  }

  /**
   * 摆放一件家具（受背包 qty 约束），并累加舒适度。
   *
   * 坐标可省略：不传就自动找第一个放得下的空位。传了就必须**完整落在网格内**
   * 且**不与已摆放家具重叠**——否则前端做布局时会出现家具叠在一起或飘到房间外，
   * 而这种脏数据一旦落库就只能靠人工清理。
   */
  async place(
    userId: string,
    itemKey: string,
    posX?: number,
    posY?: number,
  ): Promise<HomeView> {
    const def = await this.items.getDefByKey(itemKey);
    if (!def || def.type !== 'furniture') {
      throw new BadRequestException('该物品不是家具');
    }
    const grid = await this.config.get('home.grid');

    return this.lock.withLock(`pet:${userId}`, async () => {
      const ownedMap = await this.items.ownedMap(userId);
      const ownedQty = ownedMap.get(def.id) ?? 0;
      const existing = await this.layouts.find({ where: { userId } });
      const placedQty = existing.filter((l) => l.itemDefId === def.id).length;
      if (placedQty >= ownedQty) {
        throw new BadRequestException('可摆放数量不足，请先购买');
      }

      const occupied = await this.occupiedRects(existing);
      const spot = this.resolveSpot(def, occupied, grid, posX, posY);

      await this.layouts.save(
        this.layouts.create({
          userId,
          itemDefId: def.id,
          posX: spot.x,
          posY: spot.y,
        }),
      );
      return this.getHome(userId);
    });
  }

  /** 收纳一件家具。舒适度随摆放行消失自动下降，无需另行维护。 */
  async remove(userId: string, layoutId: string): Promise<HomeView> {
    return this.lock.withLock(`pet:${userId}`, async () => {
      const row = await this.layouts.findOne({
        where: { id: layoutId, userId },
      });
      if (!row) throw new NotFoundException('摆放记录不存在');
      await this.layouts.delete({ id: row.id });
      return this.getHome(userId);
    });
  }

  // ---------------------------------------------------------------- 内部

  /** 已摆放家具占用的矩形（下架家具按 1×1 保守处理）。 */
  private async occupiedRects(layouts: HomeLayout[]): Promise<Rect[]> {
    if (!layouts.length) return [];
    const ids = [...new Set(layouts.map((l) => l.itemDefId))];
    const defs = await this.defs.find({ where: { id: In(ids) } });
    const sizeOf = new Map(defs.map((d) => [d.id, { w: d.gridW, h: d.gridH }]));
    return layouts.map((l) => {
      const s = sizeOf.get(l.itemDefId) ?? { w: 1, h: 1 };
      return { x: l.posX, y: l.posY, w: s.w, h: s.h };
    });
  }

  /** 定位摆放坐标：显式坐标做校验，省略坐标则自动寻空位。 */
  private resolveSpot(
    def: ItemDef,
    occupied: Rect[],
    grid: HomeGrid,
    posX?: number,
    posY?: number,
  ): { x: number; y: number } {
    const w = Math.max(1, def.gridW);
    const h = Math.max(1, def.gridH);

    if (posX === undefined || posY === undefined) {
      const spot = findFreeSpot(w, h, occupied, grid);
      if (!spot) throw new BadRequestException('房间已摆满，请先收纳部分家具');
      return spot;
    }

    const rect: Rect = { x: posX, y: posY, w, h };
    if (!insideGrid(rect, grid)) {
      throw new BadRequestException(
        `摆放位置超出房间范围（房间 ${grid.width}×${grid.height}，该家具占 ${w}×${h}）`,
      );
    }
    if (occupied.some((r) => overlaps(rect, r))) {
      throw new BadRequestException('该位置已有家具，请换个位置');
    }
    return { x: posX, y: posY };
  }
}
