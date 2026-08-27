import { Injectable, Logger } from '@nestjs/common';
import { ClockService } from '../clock/clock.service';

/**
 * CSP 违规上报的收集器。
 *
 * 存在的理由是一个很具体的死结：CSP 配错的表现是「后台样式全丢/白屏，但控制台只有
 * 几条报错」，所以 `enforce` 之前必须先确认 /console 各页面不产生 violation；
 * 而本机（Sealos DevBox）没有任何浏览器，也装不下一个只为一次性验证服务的 Chromium。
 * 于是改成让浏览器把违规**自己送上门**：CSP 带 report-uri / report-to 指向本服务，
 * 运营用真实浏览器正常使用后台，违规就会落到日志里。挂几天没有新签名出现，
 * 就可以放心把 CSP_MODE 改成 enforce——判据从「有人盯着控制台」变成「日志里有没有」。
 *
 * 三件必须做的事，都是因为这是一个**公开、无鉴权**的端点：
 *  1. 去重。一次页面加载可能产生几十条同因违规，逐条打日志会把真正的信息淹掉。
 *  2. 截断 + 剥控制字符。上报内容完全由对端控制，`blocked-uri` 里塞换行就能伪造
 *     出一行假日志（日志注入），这在事故复盘时是会误导人的。
 *  3. 内存去重表设硬上限。不设的话，构造随机 uri 连续上报即可把进程内存顶爆。
 */

/** 同一签名在此窗口内只打一条日志。 */
const DEDUP_WINDOW_MS = 10 * 60 * 1000;
/**
 * 去重表容量上限。
 *
 * 满了之后**丢弃新签名而不是清表**：清表会让攻击者靠灌满-清空反复触发日志写入，
 * 把去重机制本身变成放大器。丢弃的代价只是极端情况下漏记几种违规，
 * 而这个端点的用途是「看有没有」，不是「一条不漏地审计」。
 */
const MAX_SIGNATURES = 500;
/** 单个字段入日志前的长度上限。`original-policy` 能有上千字符，全打没有意义。 */
const FIELD_MAX = 200;

/** 归一化后的一条违规。字段名统一成 camelCase，两种上报格式都映射到这里。 */
export interface CspViolation {
  documentUri: string;
  effectiveDirective: string;
  blockedUri: string;
  sourceFile: string;
  lineNumber: string;
  disposition: string;
}

@Injectable()
export class CspReportService {
  private readonly logger = new Logger('CspReport');
  /** 签名 → 最近一次打日志的时刻（ms）。 */
  private readonly seen = new Map<string, number>();
  /** 被去重或因表满而未记录的条数，随下一条新签名一起打出，避免静默丢失。 */
  private suppressed = 0;

  constructor(private readonly clock: ClockService) {}

  /**
   * 收取一次上报。**任何情况下都不抛错**：浏览器不看响应，抛错只会污染自己的日志。
   *
   * @param body 原始请求体，形状不可信（见 `parse`）
   * @param userAgent 用于区分「哪个浏览器报的」，同一策略在各家实现下松紧不同
   */
  record(body: unknown, userAgent?: string): void {
    let violations: CspViolation[];
    try {
      violations = this.parse(body);
    } catch {
      // 连解析都失败说明不是浏览器发来的（扫描器/手工 curl），不值得留痕
      return;
    }

    const now = this.clock.nowMs();
    this.prune(now);

    for (const v of violations) {
      const sig = `${v.effectiveDirective}|${v.blockedUri}|${v.sourceFile}|${v.lineNumber}`;
      const last = this.seen.get(sig);
      if (last !== undefined && now - last < DEDUP_WINDOW_MS) {
        this.suppressed += 1;
        continue;
      }
      if (last === undefined && this.seen.size >= MAX_SIGNATURES) {
        this.suppressed += 1;
        continue;
      }
      this.seen.set(sig, now);

      const tail =
        this.suppressed > 0 ? ` (另有 ${this.suppressed} 条被去重)` : '';
      this.suppressed = 0;
      /*
       * warn 而不是 error：report-only 阶段的违规意味着「若改成 enforce，这里会被拦」，
       * 是待处理的配置信息而非线上故障。改成 enforce 之后同一条日志的含义才变成
       * 「功能已经被拦掉了」，但那时该看的是页面表现，不是日志级别。
       */
      this.logger.warn(
        `CSP 违规 directive=${v.effectiveDirective} blocked=${v.blockedUri} ` +
          `page=${v.documentUri} source=${v.sourceFile}:${v.lineNumber} ` +
          `disposition=${v.disposition} ua=${this.clean(userAgent ?? '-')}` +
          tail,
      );
    }
  }

  /** 供测试与排查用：当前已记录的违规签名。 */
  signatures(): string[] {
    return [...this.seen.keys()];
  }

  /**
   * 把两种上报格式归一化。
   *
   * - `report-uri`（传统，Chrome/Firefox/Safari 都还在用）：
   *   `Content-Type: application/csp-report`，体是 `{ "csp-report": { "blocked-uri": ... } }`，
   *   字段 **kebab-case**。
   * - `report-to` / Reporting API（新）：`application/reports+json`，体是**数组**
   *   `[{ type: 'csp-violation', body: { blockedURL: ... } }]`，字段 **camelCase**。
   *
   * 两种都要接：只接新的会在 Safari 上收不到，只接旧的会在未来的 Chrome 上收不到，
   * 而「收不到」和「没有违规」在日志里长得一模一样——这正是本服务要避免的误判。
   */
  private parse(body: unknown): CspViolation[] {
    if (Array.isArray(body)) {
      return body
        .filter(
          (r): r is Record<string, unknown> =>
            this.isRecord(r) && r.type === 'csp-violation',
        )
        .map((r) => this.normalize(this.isRecord(r.body) ? r.body : {}));
    }
    if (this.isRecord(body)) {
      const legacy = body['csp-report'];
      if (this.isRecord(legacy)) return [this.normalize(legacy)];
    }
    return [];
  }

  private normalize(raw: Record<string, unknown>): CspViolation {
    // 每项列两个键名：前者是 Reporting API 的 camelCase，后者是 report-uri 的 kebab-case
    return {
      documentUri: this.pick(raw, 'documentURL', 'document-uri'),
      effectiveDirective: this.pick(
        raw,
        'effectiveDirective',
        'effective-directive',
        'violated-directive',
      ),
      blockedUri: this.pick(raw, 'blockedURL', 'blocked-uri'),
      sourceFile: this.pick(raw, 'sourceFile', 'source-file'),
      lineNumber: this.pick(raw, 'lineNumber', 'line-number'),
      disposition: this.pick(raw, 'disposition'),
    };
  }

  private pick(raw: Record<string, unknown>, ...keys: string[]): string {
    for (const k of keys) {
      const v = raw[k];
      if (typeof v === 'string' && v !== '') return this.clean(v);
      if (typeof v === 'number') return String(v);
    }
    return '-';
  }

  /**
   * 剥掉控制字符再截断。
   *
   * 顺序不能反：先截断后剥字符的话，被截掉的部分里若含换行就已经进了拼接结果。
   * 换行必须清掉——上报内容由对端控制，留着换行就等于允许对方在日志里插入伪造行。
   */
  private clean(v: string): string {
    // eslint-disable-next-line no-control-regex
    const flat = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    return flat.length > FIELD_MAX ? `${flat.slice(0, FIELD_MAX)}…` : flat;
  }

  /** 清掉过期签名，让同一处违规在修复后重新出现时还能被记一次。 */
  private prune(now: number): void {
    for (const [sig, at] of this.seen) {
      if (now - at >= DEDUP_WINDOW_MS) this.seen.delete(sig);
    }
  }

  private isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null;
  }
}
