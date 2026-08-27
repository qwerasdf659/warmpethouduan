import type { IncomingMessage, ServerResponse } from 'node:http';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import {
  CSP_REPORT_GROUP,
  CSP_REPORT_PATH,
  CspMode,
  buildHelmetOptions,
} from './common/security/helmet.options';

/**
 * 运行时装配（代理跳数 / 安全头 / body 解析 / 校验 / 异常 / WS 适配器）。
 *
 * `main.ts` 与 e2e 夹具**必须共用这一份**，不要在测试侧另拼一套近似的。
 * 两处各写各的时，漂移的方向永远是「线上有、测试没有」：少一个
 * `useBodyParser`，线上就是「任何 application/json 请求体都解析不出来」的
 * 整站级故障，而 e2e 可以全绿。
 *
 * CORS 不在这里：它要读 ConfigService 且只对浏览器端有意义，留在 `main.ts`。
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService);

  /*
   * 反向代理跳数。决定 req.ip 取 socket 地址还是 X-Forwarded-For。
   *
   * 这不是可有可无的一行：后台登录频控按 IP 计数（LoginThrottleService），
   * 设成 0 时 Sealos ingress 后面的所有请求会共用 ingress 的那一个 IP，
   * 20 次失败就把全部管理员一起锁在门外。
   */
  app.set('trust proxy', config.get<number>('trustProxyHops') ?? 1);

  const cspMode = (config.get<string>('cspMode') ?? 'report-only') as CspMode;
  app.use(helmet(buildHelmetOptions(cspMode)));

  /*
   * ⚠ 必须显式注册默认解析器。
   *
   * `useBodyParser` 一旦被调用，Nest 就认为 body 解析已被接管，不再于 listen()
   * 内部注册它自己的 json/urlencoded —— 于是只有下面那个 CSP 专用类型能被解析，
   * 普通 `application/json` 的 req.body 恒为空，**每个写接口都会 400**。
   * 这里显式把默认的两个补回来，顺序无关：body-parser 按 Content-Type 各管一段，
   * 且认 `req._body` 标记，不会互相覆盖。
   */
  app.useBodyParser('json');
  app.useBodyParser('urlencoded', { extended: true });

  if (cspMode !== 'off') {
    /*
     * Reporting API 的端点声明。CSP 里的 `report-to csp-endpoint` 只是引用一个组名，
     * 组名到 URL 的映射必须由这个响应头给出——少了它，`report-to` 静默失效
     * （不报错、也收不到任何上报）。传统的 `report-uri` 不依赖本头，两条并存是刻意的，
     * 理由见 helmet.options.ts 里那段注释。
     */
    app.use((_req: IncomingMessage, res: ServerResponse, next: () => void) => {
      res.setHeader(
        'Reporting-Endpoints',
        `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`,
      );
      next();
    });

    /*
     * 浏览器发违规上报用的是 application/csp-report（传统）与
     * application/reports+json（Reporting API），两者都**不是** application/json，
     * 因此上面那个默认 json 解析器不会碰它们，不额外注册的话 req.body 恒为空 ——
     * 端点看着 204 一切正常，实际什么都没收到。
     * 16kb 上限是因为 original-policy 字段本身可达几 KB，但再大就只能是灌垃圾了。
     */
    app.useBodyParser('json', {
      type: ['application/csp-report', 'application/reports+json'],
      limit: '16kb',
    });
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  // P6 实时 PvP：原生 ws（非 socket.io，与前端 wx.connectSocket 约束一致）。
  // 落在同进程同端口 8080；路径 /ws/pvp。settlement 仍走 HTTP 幂等接口。
  app.useWebSocketAdapter(new WsAdapter(app));
}
