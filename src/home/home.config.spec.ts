import {
  HOME_CONFIG,
  Rect,
  findFreeSpot,
  insideGrid,
  overlaps,
} from './home.config';

const GRID = HOME_CONFIG['home.grid'].default;

describe('家园网格', () => {
  describe('insideGrid', () => {
    it('完整落在网格内才算合法', () => {
      expect(insideGrid({ x: 0, y: 0, w: 1, h: 1 }, GRID)).toBe(true);
      expect(insideGrid({ x: 4, y: 4, w: 2, h: 2 }, GRID)).toBe(true);
    });

    it('右下角越界即非法（占格要算进去）', () => {
      // 6×6 网格里，2×2 家具的左上角最多到 (4,4)
      expect(insideGrid({ x: 5, y: 5, w: 2, h: 2 }, GRID)).toBe(false);
      expect(insideGrid({ x: 6, y: 0, w: 1, h: 1 }, GRID)).toBe(false);
    });

    it('负坐标非法', () => {
      expect(insideGrid({ x: -1, y: 0, w: 1, h: 1 }, GRID)).toBe(false);
    });
  });

  describe('overlaps', () => {
    it('相交判为重叠', () => {
      expect(
        overlaps({ x: 0, y: 0, w: 2, h: 2 }, { x: 1, y: 1, w: 2, h: 2 }),
      ).toBe(true);
    });

    it('相邻不算重叠', () => {
      expect(
        overlaps({ x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 0, w: 2, h: 2 }),
      ).toBe(false);
      expect(
        overlaps({ x: 0, y: 0, w: 2, h: 2 }, { x: 0, y: 2, w: 2, h: 2 }),
      ).toBe(false);
    });

    it('完全包含判为重叠', () => {
      expect(
        overlaps({ x: 0, y: 0, w: 4, h: 4 }, { x: 1, y: 1, w: 1, h: 1 }),
      ).toBe(true);
    });
  });

  describe('findFreeSpot', () => {
    it('空房间从左上角开始放', () => {
      expect(findFreeSpot(2, 2, [], GRID)).toEqual({ x: 0, y: 0 });
    });

    it('跳过已占用区域', () => {
      const occupied: Rect[] = [{ x: 0, y: 0, w: 2, h: 2 }];
      expect(findFreeSpot(2, 2, occupied, GRID)).toEqual({ x: 2, y: 0 });
    });

    it('一行放不下就换行', () => {
      const occupied: Rect[] = [{ x: 0, y: 0, w: 6, h: 1 }];
      expect(findFreeSpot(1, 1, occupied, GRID)).toEqual({ x: 0, y: 1 });
    });

    it('放不下时返回 null（由调用方转成明确报错）', () => {
      const full: Rect[] = [{ x: 0, y: 0, w: 6, h: 6 }];
      expect(findFreeSpot(1, 1, full, GRID)).toBeNull();
    });

    it('大件家具在碎片化房间里找不到位置也不会误放', () => {
      // 交错占满，剩下的空格都是 1×1，放不下 2×2
      const occupied: Rect[] = [];
      for (let y = 0; y < 6; y++) {
        for (let x = y % 2 === 0 ? 0 : 1; x < 6; x += 2) {
          occupied.push({ x, y, w: 1, h: 1 });
        }
      }
      expect(findFreeSpot(2, 2, occupied, GRID)).toBeNull();
    });
  });
});
