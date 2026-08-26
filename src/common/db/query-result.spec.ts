import { rowsOf } from './query-result';

/**
 * 用例里的形状全部是在本库 PostgreSQL 16 + TypeORM 上**实测**得到的，
 * 不是照文档抄的。TypeORM 换版本后如果形状变了，这些用例会先红，
 * 那正是我们想要的信号 —— 三个原子占用点（余额、兑换码、库存）都依赖它。
 */
describe('rowsOf', () => {
  describe('UPDATE / DELETE ... RETURNING → [rows, affected]', () => {
    it('未命中时剥出空数组，而不是把长度 2 的外层数组当成两行', () => {
      expect(rowsOf([[], 0])).toEqual([]);
    });

    it('命中时剥出内层行', () => {
      expect(rowsOf([[{ id: '1' }], 1])).toEqual([{ id: '1' }]);
    });

    it('命中多行时全部剥出', () => {
      expect(rowsOf([[{ id: '1' }, { id: '2' }], 2])).toHaveLength(2);
    });
  });

  describe('SELECT / INSERT ... RETURNING → rows[]', () => {
    it('SELECT 结果原样返回', () => {
      expect(rowsOf([{ id: '1' }])).toEqual([{ id: '1' }]);
    });

    it('INSERT ... ON CONFLICT DO NOTHING 撞码时是裸空数组', () => {
      expect(rowsOf([])).toEqual([]);
    });

    it('恰好两行的 SELECT 不会被误判成 [rows, affected]', () => {
      // 判据是「第二个元素为 number」，而行永远是对象，所以不会误剥
      const twoRows = [{ id: '1' }, { id: '2' }];
      expect(rowsOf(twoRows)).toEqual(twoRows);
    });
  });

  describe('异常输入', () => {
    it.each([[null], [undefined], [{}], [0], ['']])(
      '非数组一律当作空结果：%p',
      (input) => {
        expect(rowsOf(input)).toEqual([]);
      },
    );
  });
});
