import { Logger } from '@nestjs/common';
import { ClockService } from '../clock/clock.service';
import { CspReportService } from './csp-report.service';

/**
 * 这些用例守的是「上报真的收得到、且收不爆」这件事。
 *
 * 之所以值得写测试：这个端点的失效形态是**静默**的——两种上报格式里漏认一种、
 * 字段名映射错一个，表现都是日志里一条不落地干净，而「干净」恰好又是我们期待
 * 看到的最终状态。没有用例钉住的话，无从区分「没有违规」与「根本没收到」。
 */
describe('CspReportService', () => {
  let svc: CspReportService;
  let warn: jest.SpyInstance;
  let nowMs: number;

  beforeEach(() => {
    nowMs = 1_700_000_000_000;
    const clock = { nowMs: () => nowMs } as unknown as ClockService;
    svc = new CspReportService(clock);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => warn.mockRestore());

  /**
   * 取出已打出的日志正文。
   *
   * `mock.calls` 的元素类型是 any，逐处下标取值会触发 no-unsafe-member-access；
   * 按仓库既有约定「声明形状 + 只转一次」收在这里，用例里就都是 string 了。
   */
  const lines = (): string[] =>
    (warn.mock.calls as unknown as unknown[][]).map((c) => String(c[0]));

  /** 传统 report-uri 格式：kebab-case 字段，外层包一个 csp-report。 */
  const legacy = (overrides: Record<string, unknown> = {}) => ({
    'csp-report': {
      'document-uri': 'https://x.test/console/',
      'violated-directive': 'script-src',
      'effective-directive': 'script-src',
      'blocked-uri': 'inline',
      'source-file': 'https://x.test/console/umi.js',
      'line-number': 42,
      disposition: 'report',
      ...overrides,
    },
  });

  /** Reporting API 格式：数组 + camelCase 字段 + type 判别。 */
  const modern = (overrides: Record<string, unknown> = {}) => [
    {
      age: 0,
      type: 'csp-violation',
      url: 'https://x.test/console/',
      body: {
        documentURL: 'https://x.test/console/',
        effectiveDirective: 'style-src',
        blockedURL: 'inline',
        sourceFile: 'https://x.test/console/index.html',
        lineNumber: 7,
        disposition: 'enforce',
        ...overrides,
      },
    },
  ];

  describe('两种上报格式都要认', () => {
    it('report-uri（application/csp-report）能落日志', () => {
      svc.record(legacy());
      expect(warn).toHaveBeenCalledTimes(1);
      expect(lines()[0]).toContain('directive=script-src');
      expect(lines()[0]).toContain('source=https://x.test/console/umi.js:42');
    });

    it('report-to（application/reports+json）能落日志', () => {
      svc.record(modern());
      expect(warn).toHaveBeenCalledTimes(1);
      expect(lines()[0]).toContain('directive=style-src');
    });

    it('数组里非 csp-violation 的上报（如 deprecation）被忽略', () => {
      svc.record([{ type: 'deprecation', body: { id: 'x' } }]);
      expect(warn).not.toHaveBeenCalled();
    });

    it('effective-directive 缺失时回落到 violated-directive', () => {
      svc.record(legacy({ 'effective-directive': undefined }));
      expect(lines()[0]).toContain('directive=script-src');
    });
  });

  describe('形状不可信：任何输入都不能抛错', () => {
    it.each([
      [null],
      [undefined],
      [{}],
      [[]],
      [0],
      [''],
      ['x'],
      [{ 'csp-report': 1 }],
    ])('%p 既不抛错也不打日志', (input) => {
      expect(() => svc.record(input)).not.toThrow();
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('去重', () => {
    it('同一签名在窗口内只打一条', () => {
      svc.record(legacy());
      svc.record(legacy());
      svc.record(legacy());
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('被去重的条数随下一条新签名一起报出，不静默丢失', () => {
      svc.record(legacy());
      svc.record(legacy());
      svc.record(legacy({ 'blocked-uri': 'https://evil.test/a.js' }));
      expect(warn).toHaveBeenCalledTimes(2);
      expect(lines()[1]).toContain('另有 1 条被去重');
    });

    it('不同 directive 视为不同签名', () => {
      svc.record(legacy());
      svc.record(legacy({ 'effective-directive': 'img-src' }));
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('窗口过期后同一处违规会重新记一次（修复后复发要能看见）', () => {
      svc.record(legacy());
      nowMs += 10 * 60 * 1000 + 1;
      svc.record(legacy());
      expect(warn).toHaveBeenCalledTimes(2);
      expect(svc.signatures()).toHaveLength(1);
    });
  });

  describe('抗滥用（公开端点）', () => {
    it('去重表有硬上限，随机 uri 灌不爆内存', () => {
      for (let i = 0; i < 800; i += 1) {
        svc.record(legacy({ 'blocked-uri': `https://evil.test/${i}.js` }));
      }
      expect(svc.signatures().length).toBeLessThanOrEqual(500);
    });

    it('换行被剥掉，防止对端在日志里伪造一整行', () => {
      svc.record(
        legacy({ 'blocked-uri': 'a\n[Nest] ERROR 伪造的一行\r第二段' }),
      );
      const line = lines()[0];
      expect(line).not.toContain('\n');
      expect(line).not.toContain('\r');
      expect(line).toContain('blocked=a [Nest] ERROR 伪造的一行 第二段');
    });

    it('超长字段被截断', () => {
      svc.record(legacy({ 'blocked-uri': 'x'.repeat(5000) }));
      const line = lines()[0];
      expect(line).toContain('…');
      expect(line.length).toBeLessThan(1200);
    });

    it('user-agent 同样经过清洗后才入日志', () => {
      svc.record(legacy(), 'Mozilla/5.0\n注入');
      const line = lines()[0];
      expect(line).not.toContain('\n');
      expect(line).toContain('ua=Mozilla/5.0 注入');
    });
  });
});
