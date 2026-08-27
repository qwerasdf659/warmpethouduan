import {
  buildHelmetOptions,
  CSP_REPORT_GROUP,
  CSP_REPORT_PATH,
  type CspMode,
} from './helmet.options';

/**
 * 这些用例钉住的是**安全策略本身**，不是代码行为。
 *
 * 它们的价值在于：CSP 的每一处放宽都很容易被当成「修个样式 bug」顺手做掉
 * （给 script-src 加 'unsafe-inline' 是最典型的一次性解法），而放宽之后 CSP
 * 对 XSS 就基本失效了，且没有任何测试或运行现象会提示这件事。
 * 想真的放宽时，改测试是必须迈过的一道坎 —— 那一刻才会去想清楚代价。
 */
type Directives = Record<string, unknown>;

function directivesOf(mode: CspMode): Directives {
  const csp = buildHelmetOptions(mode).contentSecurityPolicy;
  if (typeof csp !== 'object' || csp === null) {
    throw new Error(`${mode} 档没有产出 CSP 配置`);
  }
  return (csp as { directives: Directives }).directives;
}

describe('buildHelmetOptions', () => {
  describe('非 CSP 的头：与档位无关，恒定强制', () => {
    it.each<CspMode>(['enforce', 'report-only', 'off'])(
      '%s 档也照样给 frameguard / hsts / referrerPolicy',
      (mode) => {
        const o = buildHelmetOptions(mode);
        // 点击劫持是 /console 与 API 同源部署下最直接的风险，
        // 而 CSP 处于 report-only 时真正挡住它的就是这个头
        expect(o.frameguard).toEqual({ action: 'deny' });
        expect(o.referrerPolicy).toEqual({ policy: 'no-referrer' });
        expect(o.hsts).toMatchObject({ includeSubDomains: true });
      },
    );
  });

  describe('CSP 档位', () => {
    it('off 档完全关掉 CSP（只用于排查「是不是 CSP 造成的」）', () => {
      expect(buildHelmetOptions('off').contentSecurityPolicy).toBe(false);
    });

    it('report-only 档只观察不拦截', () => {
      const csp = buildHelmetOptions('report-only').contentSecurityPolicy;
      expect(csp).toMatchObject({ reportOnly: true });
    });

    it('enforce 档真正拦截', () => {
      const csp = buildHelmetOptions('enforce').contentSecurityPolicy;
      expect(csp).toMatchObject({ reportOnly: false });
    });
  });

  describe('策略内容（放宽前请先想清楚代价）', () => {
    it('script-src 不含 unsafe-inline / unsafe-eval —— 这是整条 CSP 最值钱的部分', () => {
      const d = directivesOf('enforce');
      expect(d.scriptSrc).toEqual(["'self'"]);
    });

    it('style-src 确实放开了 unsafe-inline（antd cssinjs 运行时注入 <style>，覆盖不到）', () => {
      const d = directivesOf('enforce');
      expect(d.styleSrc).toContain("'unsafe-inline'");
    });

    it('frame-ancestors 为 none，object-src 为 none', () => {
      const d = directivesOf('enforce');
      expect(d.frameAncestors).toEqual(["'none'"]);
      expect(d.objectSrc).toEqual(["'none'"]);
    });

    it('不使用 helmet 默认值，避免默认集变化时策略被静默改写', () => {
      const csp = buildHelmetOptions('enforce').contentSecurityPolicy;
      expect(csp).toMatchObject({ useDefaults: false });
    });
  });

  describe('违规上报（转 enforce 的判据全靠它）', () => {
    it.each<CspMode>(['enforce', 'report-only'])(
      '%s 档同时给 report-uri 与 report-to',
      (mode) => {
        const d = directivesOf(mode);
        // 两个都要：report-uri 是 Safari/旧版浏览器唯一认的，report-to 是新标准。
        // 只留一个的后果是在某类浏览器上一条都收不到，而那和「没有违规」难以区分
        expect(d.reportUri).toEqual([CSP_REPORT_PATH]);
        expect(d.reportTo).toEqual([CSP_REPORT_GROUP]);
      },
    );

    it('上报路径与组名是常量，不能各处写字面量', () => {
      // main.ts 的 Reporting-Endpoints 头、AppController 的路由、这里的指令三处共用；
      // 任一处写死字面量并改动，结果就是静默收不到上报
      expect(CSP_REPORT_PATH).toBe('/csp-report');
      expect(CSP_REPORT_GROUP).toBe('csp-endpoint');
    });
  });
});
