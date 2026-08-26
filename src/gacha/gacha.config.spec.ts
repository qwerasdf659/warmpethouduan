import { SEED_ASSETS } from '../ledger/asset-seed';
import {
  GACHA_CONFIG,
  GachaEntry,
  getGachaPool,
  pickEntry,
  pickRareEntry,
  probabilityTable,
  totalWeight,
} from './gacha.config';

const entry = (key: string, weight: number, rare = false): GachaEntry => ({
  key,
  name: key,
  weight,
  itemKey: 'cons_snack',
  qty: 1,
  rare,
});

describe('gacha.config', () => {
  const entries = [entry('a', 70), entry('b', 20), entry('c', 10, true)];

  it('pickEntry 落在权重区间的正确档位上', () => {
    // 边界从下界开始：rand=0 必须是第一档，0.699…仍在第一档
    expect(pickEntry(entries, () => 0).key).toBe('a');
    expect(pickEntry(entries, () => 0.699).key).toBe('a');
    expect(pickEntry(entries, () => 0.7).key).toBe('b');
    expect(pickEntry(entries, () => 0.899).key).toBe('b');
    expect(pickEntry(entries, () => 0.9).key).toBe('c');
    // rand 理论上取不到 1，但浮点累加误差可能走到末尾，必须兜住而非返回 undefined
    expect(pickEntry(entries, () => 0.999999).key).toBe('c');
  });

  it('pickEntry 的经验分布贴合权重（不出现模偏差）', () => {
    let seed = 1;
    // 线性同余，固定种子保证可复现
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const hits: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 60_000; i += 1) hits[pickEntry(entries, rand).key] += 1;

    expect(hits.a / 60_000).toBeCloseTo(0.7, 1);
    expect(hits.b / 60_000).toBeCloseTo(0.2, 1);
    expect(hits.c / 60_000).toBeCloseTo(0.1, 1);
  });

  it('pickRareEntry 只在稀有档里抽；无稀有档时返回 null', () => {
    expect(pickRareEntry(entries, () => 0.5)?.key).toBe('c');
    expect(pickRareEntry([entry('a', 1)], () => 0.5)).toBeNull();
  });

  it('probabilityTable 换算成百分比且合计为 100', () => {
    const table = probabilityTable(entries);
    expect(table.map((t) => t.percent)).toEqual([70, 20, 10]);
    expect(table.reduce((a, t) => a + t.percent, 0)).toBeCloseTo(100, 4);
  });

  it('totalWeight / getGachaPool', () => {
    expect(totalWeight(entries)).toBe(100);
    const pools = GACHA_CONFIG['gacha.pools'].default;
    expect(getGachaPool(pools, 'daily')?.key).toBe('daily');
    expect(getGachaPool(pools, 'nope')).toBeUndefined();
  });

  describe('默认奖池', () => {
    const pools = GACHA_CONFIG['gacha.pools'].default;
    const assetOf = (code: string) => SEED_ASSETS.find((a) => a.code === code);

    it('通过自身 schema 校验', () => {
      const { error } = GACHA_CONFIG['gacha.pools'].schema.validate(pools);
      expect(error).toBeUndefined();
    });

    it('保底可达：有稀有档，否则保底会永远触发不了', () => {
      for (const p of pools) {
        if (p.pity > 0) expect(p.entries.some((e) => e.rare)).toBe(true);
      }
    });

    it('十连有折扣，否则连抽没有存在意义', () => {
      for (const p of pools) expect(p.costTen).toBeLessThan(p.cost * 10);
    });

    /**
     * D1 的核心约束。产出里出现货币会让 `game_coin` 同时需要 `tradable`
     * （它是交易媒介）和 `gachaOutput`，而 `ck_asset_no_trade_gacha` 会在
     * 播种时就把这份配置拒掉 —— 与其等到启动失败，不如在这里拦住。
     */
    it('产出里没有任何货币（D1：扭蛋不产币）', () => {
      for (const p of pools) {
        for (const e of p.entries) {
          expect(assetOf(e.itemKey)?.kind).not.toBe('currency');
        }
      }
      for (const p of pools) {
        if (p.dupeItemKey) {
          expect(assetOf(p.dupeItemKey)?.kind).not.toBe('currency');
        }
      }
    });

    /**
     * 合规红线的另一半：扭蛋产出物必须不可交易，否则「投入货币 → 随机 →
     * 产出可变现资产」这条链就通了，那是开箱模式。
     */
    it('所有产出物在资产表里都是不可交易的', () => {
      for (const p of pools) {
        for (const e of p.entries) {
          const asset = assetOf(e.itemKey);
          expect(asset).toBeDefined();
          expect(asset?.tradable).toBe(false);
          expect(asset?.gachaOutput).toBe(true);
        }
      }
    });

    it('期望回收低于单抽成本，否则扭蛋从 sink 变成印钞机', () => {
      for (const p of pools) {
        const total = totalWeight(p.entries);
        // 产出按**商店售价**估值取上界：最乐观情况下（每一件都当原价买来的用）
        // 也不该回本
        const expected = p.entries.reduce((sum, e) => {
          const price = assetOf(e.itemKey)?.meta?.price ?? 0;
          return sum + (Number(price) * e.qty * e.weight) / total;
        }, 0);
        expect(expected).toBeLessThan(p.cost);
      }
    });

    it('每一档都指向真实存在的资产，且件数为正', () => {
      for (const p of pools) {
        for (const e of p.entries) {
          expect(assetOf(e.itemKey)).toBeDefined();
          expect(e.qty).toBeGreaterThan(0);
        }
      }
    });

    it('档位 key 不重名（重名会让概率公示对不上号）', () => {
      for (const p of pools) {
        const keys = p.entries.map((e) => e.key);
        expect(new Set(keys).size).toBe(keys.length);
      }
    });
  });

  describe('schema 拦截非法配置', () => {
    const validate = (pools: unknown) =>
      GACHA_CONFIG['gacha.pools'].schema.validate(pools).error;

    const base = {
      key: 'p',
      name: 'p',
      pool: 'game',
      cost: 100,
      costTen: 900,
      pity: 10,
      dupeItemKey: 'cons_snack',
      dupeQty: 2,
    };

    it('拒绝空档位表', () => {
      expect(validate([{ ...base, entries: [] }])).toBeDefined();
    });

    it('拒绝零权重（永远抽不到的档位是配置错误）', () => {
      expect(
        validate([{ ...base, entries: [{ ...entry('a', 0) }] }]),
      ).toBeDefined();
    });

    it('拒绝没有 itemKey 的档位', () => {
      expect(
        validate([{ ...base, entries: [{ ...entry('a', 1), itemKey: null }] }]),
      ).toBeDefined();
    });

    it('拒绝 qty=0（抽到了却什么都不给）', () => {
      expect(
        validate([{ ...base, entries: [{ ...entry('a', 1), qty: 0 }] }]),
      ).toBeDefined();
    });

    it('允许 dupeItemKey=null（不做重复补偿）', () => {
      expect(
        validate([
          { ...base, dupeItemKey: null, dupeQty: 0, entries: [entry('a', 1)] },
        ]),
      ).toBeUndefined();
    });

    it('允许空数组（整体下架扭蛋）', () => {
      expect(validate([])).toBeUndefined();
    });
  });
});
