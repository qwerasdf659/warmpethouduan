import { Body, Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { AppService } from './app.service';
import { CspReportService } from './common/security/csp-report.service';
import { CSP_REPORT_PATH } from './common/security/helmet.options';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly cspReport: CspReportService,
  ) {}

  @Get('health')
  health() {
    return this.appService.health();
  }

  /**
   * CSP 违规上报接收端（公开、无鉴权、只落日志）。
   *
   * 为什么必须是公开端点：上报是浏览器自己发的，不带 Authorization 也不带 Cookie，
   * 而且违规最可能发生在**登录页**——那时还没有任何凭证可用。加鉴权等于只收得到
   * 已登录页面的违规，恰好漏掉最需要看的那一段。
   *
   * `@Body() body: unknown` 是有意的：全局 ValidationPipe 开了 forbidNonWhitelisted，
   * 若声明成 DTO，各家浏览器字段名不一（kebab-case / camelCase / 多出的 age、type）
   * 会被直接判 400，上报全部丢掉。ValidationPipe 对无 class 元类型的参数不校验，
   * 所以这里绕开的是校验、不是安全——形状不可信的处理全在 CspReportService 里做。
   *
   * 204 且空体：浏览器不读响应内容，回什么都一样，不如别产生回包。
   * 限流由全局 ThrottlerGuard 兜底（每 IP 每端点每分钟 100 次）；被限流只是丢几条
   * 重复上报，而同一处违规去重后只需要一条就够用。
   */
  @Post(CSP_REPORT_PATH)
  @HttpCode(204)
  reportCspViolation(
    @Body() body: unknown,
    @Headers('user-agent') userAgent?: string,
  ): void {
    this.cspReport.record(body, userAgent);
  }
}
