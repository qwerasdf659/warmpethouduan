import {
  RACE_CONFIG,
  baseFinishTime,
  gradeOf,
  jitterTime,
  npcFinishTime,
  rankOf,
} from './race.config';

const FORMULA = RACE_CONFIG['race.formula'].default;
const THRESHOLDS = RACE_CONFIG['race.grade_thresholds'].default;
const TRACKS = RACE_CONFIG['race.tracks'].default;

const meadow = TRACKS[0];
const mountain = TRACKS[2];

/** 建议等级宠的三围（与迁移里 estimateTargetTime 用的同一条成长曲线）。 */
function statOfLevel(level: number, mood = 100) {
  return {
    speed: 10 + 1.0 * (level - 1),
    endurance: 10 + 0.8 * (level - 1),
    mood,
  };
}

describe('赛跑完赛时间模型', () => {
  describe('baseFinishTime', () => {
    it('速度越高完赛越快', () => {
      const slow = baseFinishTime(statOfLevel(1), meadow, FORMULA);
      const fast = baseFinishTime(statOfLevel(20), meadow, FORMULA);
      expect(fast).toBeLessThan(slow);
    });

    it('心情参与配速：心情差跑得更慢', () => {
      const happy = baseFinishTime(statOfLevel(5, 100), meadow, FORMULA);
      const sad = baseFinishTime(statOfLevel(5, 0), meadow, FORMULA);
      expect(sad).toBeGreaterThan(happy);
      // moodBase=0.8 → 心情归零时配速只剩 80%，耗时约为 1/0.8 倍（掉速项不受心情影响）
      expect(sad / happy).toBeGreaterThan(1.1);
      expect(sad / happy).toBeLessThan(1.25);
    });

    it('耐力不足产生后程掉速，且长赛道惩罚更重', () => {
      const lowEnd = { speed: 20, endurance: 5, mood: 100 };
      const highEnd = { speed: 20, endurance: 40, mood: 100 };

      const shortGap =
        baseFinishTime(lowEnd, meadow, FORMULA) -
        baseFinishTime(highEnd, meadow, FORMULA);
      const longGap =
        baseFinishTime(lowEnd, mountain, FORMULA) -
        baseFinishTime(highEnd, mountain, FORMULA);

      expect(shortGap).toBeGreaterThan(0);
      // 距离 300 vs 100，掉速差应约 3 倍
      expect(longGap).toBeGreaterThan(shortGap * 2.5);
    });

    it('耐力达到基准即无掉速（再高也不会更快）', () => {
      const atBase = { speed: 20, endurance: FORMULA.enduranceBase, mood: 100 };
      const overBase = {
        speed: 20,
        endurance: FORMULA.enduranceBase * 3,
        mood: 100,
      };
      expect(baseFinishTime(atBase, mountain, FORMULA)).toBe(
        baseFinishTime(overBase, mountain, FORMULA),
      );
    });

    it('配置被改到极端值也不产出 0/负数/NaN 的完赛时间', () => {
      const broken = { ...FORMULA, moodBase: 0.01, paceConstant: 0.01 };
      const t = baseFinishTime(
        { speed: 0, endurance: 0, mood: 0 },
        meadow,
        broken,
      );
      expect(Number.isFinite(t)).toBe(true);
      expect(t).toBeGreaterThan(0);
    });
  });

  describe('赛道基准时间标定', () => {
    it('建议等级 + 满心情跑对应赛道，评级落在 A 或更好', () => {
      for (const track of TRACKS) {
        const base = baseFinishTime(
          statOfLevel(track.recommendLevel),
          track,
          FORMULA,
        );
        const grade = gradeOf(base, track, THRESHOLDS);
        expect(['S', 'A']).toContain(grade);
      }
    });

    it('远低于建议等级去跑高难赛道会拿 C', () => {
      const base = baseFinishTime(statOfLevel(1), mountain, FORMULA);
      expect(gradeOf(base, mountain, THRESHOLDS)).toBe('C');
    });
  });

  describe('gradeOf', () => {
    const track = { ...meadow, targetTime: 100 };

    it('按阈值分档，边界值取更好的一档', () => {
      expect(gradeOf(100 * THRESHOLDS.S, track, THRESHOLDS)).toBe('S');
      expect(gradeOf(100 * THRESHOLDS.A, track, THRESHOLDS)).toBe('A');
      expect(gradeOf(100 * THRESHOLDS.B, track, THRESHOLDS)).toBe('B');
      expect(gradeOf(100 * THRESHOLDS.B + 0.001, track, THRESHOLDS)).toBe('C');
    });
  });

  describe('rankOf', () => {
    it('名次 = 1 + 比自己快的影子数', () => {
      expect(rankOf(20, [18, 19, 25])).toBe(3);
      expect(rankOf(10, [18, 19, 25])).toBe(1);
      expect(rankOf(30, [18, 19, 25])).toBe(4);
    });

    it('完赛时间相同不算被超越（并列取靠前名次）', () => {
      expect(rankOf(20, [20, 20])).toBe(1);
    });
  });

  describe('npcFinishTime', () => {
    it('难度越高的赛道，影子越快', () => {
      const mid = () => 0.5;
      const easy = npcFinishTime(100, { ...meadow, difficulty: 1 }, mid);
      const hard = npcFinishTime(100, { ...meadow, difficulty: 2 }, mid);
      expect(hard).toBeLessThan(easy);
    });

    it('同难度下影子强度在玩家基准附近浮动，不会碾压也不会摆烂', () => {
      const track = { ...meadow, difficulty: 1 };
      const fastest = npcFinishTime(100, track, () => 1);
      const slowest = npcFinishTime(100, track, () => 0);
      expect(fastest).toBeGreaterThan(90);
      expect(slowest).toBeLessThan(130);
    });
  });

  describe('jitterTime', () => {
    it('扰动幅度不超过配置的比例', () => {
      const lo = jitterTime(100, 0.05, () => 0);
      const hi = jitterTime(100, 0.05, () => 1);
      expect(lo).toBeCloseTo(95, 3);
      expect(hi).toBeCloseTo(105, 3);
    });

    it('jitter=0 时结果确定', () => {
      expect(jitterTime(42.5, 0)).toBe(42.5);
    });
  });
});
