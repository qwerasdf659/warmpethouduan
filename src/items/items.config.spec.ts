import { ITEMS_CONFIG, isEmptyEffect } from './items.config';

describe('items.config', () => {
  const schema = ITEMS_CONFIG['items.consumables'].schema;
  const validate = (v: unknown) => schema.validate(v).error;

  it('默认表通过自身校验', () => {
    expect(validate(ITEMS_CONFIG['items.consumables'].default)).toBeUndefined();
  });

  it('默认表里每一项都有实际效果', () => {
    for (const [key, effect] of Object.entries(
      ITEMS_CONFIG['items.consumables'].default,
    )) {
      expect(isEmptyEffect(effect)).toBe(false);
      expect(key.startsWith('cons_')).toBe(true);
    }
  });

  it('拒绝空效果：扣了道具什么都不发生是最难解释的一类问题', () => {
    expect(validate({ cons_x: {} })).toBeDefined();
  });

  it('拒绝负增益：消耗品是花钱买的正向道具，不留调坏宠物的口子', () => {
    expect(validate({ cons_x: { hunger: -10 } })).toBeDefined();
  });

  it('拒绝未知字段，避免拼错字段名后静默失效', () => {
    expect(validate({ cons_x: { hunge: 10 } })).toBeDefined();
  });

  it('状态类增益上界 100（状态值本身就是 0~100）', () => {
    expect(validate({ cons_x: { hunger: 100 } })).toBeUndefined();
    expect(validate({ cons_x: { hunger: 101 } })).toBeDefined();
  });

  it('经验不受 100 约束，但也不能一口升十级', () => {
    expect(validate({ cons_x: { exp: 5000 } })).toBeUndefined();
    expect(validate({ cons_x: { exp: 10_001 } })).toBeDefined();
  });

  describe('isEmptyEffect', () => {
    it('缺省、空对象、全零都算空', () => {
      expect(isEmptyEffect(undefined)).toBe(true);
      expect(isEmptyEffect({})).toBe(true);
      expect(isEmptyEffect({ hunger: 0, exp: 0 })).toBe(true);
    });

    it('任一项非零即非空', () => {
      expect(isEmptyEffect({ mood: 1 })).toBe(false);
      expect(isEmptyEffect({ exp: 1 })).toBe(false);
    });
  });
});
