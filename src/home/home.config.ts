/**
 * 家园可调数值。
 *
 * 舒适度本身的口径在 `pet.comfort`（因为它作用于宠物：减缓 mood 衰减、
 * 提升离线产出），这里只放**房间布局**相关的参数。
 */
import {
  defineConfig,
  nonNegInt,
  posInt,
  strictObject,
} from '../config/game-config.types';
import type { ShapeOf } from '../config/game-config.types';

export interface HomeGrid {
  /** 房间宽（格） */
  width: number;
  /** 房间高（格） */
  height: number;
}

const DEFAULT_GRID: HomeGrid = { width: 6, height: 6 };

/** 家园访问/点赞（P9）。 */
export interface HomeVisit {
  /** 每次点赞给被访问者发的游戏币（每人每天对同一目标限一次） */
  likeRewardCoin: number;
}

const DEFAULT_VISIT: HomeVisit = { likeRewardCoin: 10 };

export const HOME_CONFIG = {
  'home.grid': defineConfig<HomeGrid>({
    description: '家园房间网格尺寸（格）。缩小后已越界的旧摆放不会被自动清理',
    default: DEFAULT_GRID,
    schema: strictObject({
      // 上限 64 是保护：网格越大，摆放校验要比对的矩形越多
      width: posInt.max(64).required(),
      height: posInt.max(64).required(),
    }),
  }),

  'home.visit': defineConfig<HomeVisit>({
    description: '家园访问：点赞给被访问者发币，每人每天对同一目标一次',
    default: DEFAULT_VISIT,
    schema: strictObject({
      likeRewardCoin: nonNegInt.max(10_000).required(),
    }),
  }),
};

export type HomeConfigShape = ShapeOf<typeof HOME_CONFIG>;

// ------------------------------------------------------------------ 纯函数

/** 一件家具占据的矩形（左上角 + 尺寸）。 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 矩形是否完整落在网格内。 */
export function insideGrid(rect: Rect, grid: HomeGrid): boolean {
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.w <= grid.width &&
    rect.y + rect.h <= grid.height
  );
}

/** 两个矩形是否重叠（相邻不算重叠）。 */
export function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

/**
 * 在网格里找第一个能放下 w×h 的空位（从左上角逐行扫）。
 *
 * 存在的意义是让 `posX`/`posY` 保持可选：前端做「一键摆放」或还没做布局 UI 时
 * 不传坐标也能摆，而不是全都堆在 (0,0) 互相重叠。
 */
export function findFreeSpot(
  w: number,
  h: number,
  occupied: Rect[],
  grid: HomeGrid,
): { x: number; y: number } | null {
  for (let y = 0; y + h <= grid.height; y++) {
    for (let x = 0; x + w <= grid.width; x++) {
      const candidate = { x, y, w, h };
      if (!occupied.some((r) => overlaps(candidate, r))) return { x, y };
    }
  }
  return null;
}
