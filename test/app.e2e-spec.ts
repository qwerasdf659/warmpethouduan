import { ConfigModule } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import configuration from './../src/config/configuration';
import { configureApp } from './../src/bootstrap';
import { AppController } from './../src/app.controller';
import { AppService } from './../src/app.service';
import { ClockService } from './../src/common/clock/clock.service';
import { CspReportService } from './../src/common/security/csp-report.service';

// 只装配 AppController 及其直接依赖，避免在 CI 里拉起 Postgres/Redis 全量依赖。
// CspReportService 只依赖 ClockService，两者都无外部依赖，所以进得来。
describe('AppController (e2e)', () => {
  let app: NestExpressApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      // ConfigModule 是 configureApp 的依赖（trustProxyHops / cspMode），
      // 且它不碰任何外部服务，进得来
      imports: [ConfigModule.forRoot({ load: [configuration] })],
      controllers: [AppController],
      providers: [AppService, ClockService, CspReportService],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    // 走 main.ts 的同一份装配，而不是手抄一套管道：
    // body 解析器的注册就在那里，手抄的夹具永远测不到它。
    configureApp(app);
    await app.init();
  });

  it('/health (GET) 返回服务健康状态', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    const body = res.body as { time?: unknown };
    expect(body).toMatchObject({
      status: 'ok',
      service: 'warmpet-api',
    });
    expect(typeof body.time).toBe('string');
  });

  /*
   * body 解析器的注册（`configureApp`）现在也在夹具里，因此浏览器真正会发的两个
   * Content-Type 可以直接在这里验，不必再靠真机 curl 核对。
   *
   * 这三条是一组：普通 json 与两个 CSP 专用类型必须**同时**可解析。
   * 只注册 CSP 那两个会顶掉默认 json 解析器，线上每个写接口的 req.body 都会变空；
   * 反过来只留默认的，则收不到任何违规上报。
   */
  describe('body 解析器覆盖面', () => {
    it('普通 application/json 能被解析（守住「CSP 解析器顶掉默认解析器」）', async () => {
      // 顶层裸标量只有在 body 真的被解析时才会被 strict 模式判 400；
      // 解析器缺席时 body 恒空、请求会一路 204，因此这条能区分两者。
      await request(app.getHttpServer())
        .post('/csp-report')
        .set('Content-Type', 'application/json')
        .send('"just a string"')
        .expect(400);
    });

    it('application/csp-report（传统 report-uri）能被解析', async () => {
      await request(app.getHttpServer())
        .post('/csp-report')
        .set('Content-Type', 'application/csp-report')
        .send('"just a string"')
        .expect(400);
    });

    it('application/reports+json（Reporting API）能被解析', async () => {
      await request(app.getHttpServer())
        .post('/csp-report')
        .set('Content-Type', 'application/reports+json')
        .send('"just a string"')
        .expect(400);
    });
  });

  /* 这几条守的是「控制器与全局管道不会把上报挡掉」。 */
  describe('POST /csp-report', () => {
    it('传统 report-uri 形状的体被接受且回 204', async () => {
      await request(app.getHttpServer())
        .post('/csp-report')
        .set('Content-Type', 'application/json')
        .send({
          'csp-report': {
            'document-uri': 'http://localhost/console/',
            'violated-directive': 'script-src',
            'blocked-uri': 'inline',
          },
        })
        .expect(204);
    });

    it('Reporting API 形状（数组）的体被接受且回 204', async () => {
      await request(app.getHttpServer())
        .post('/csp-report')
        .set('Content-Type', 'application/json')
        .send([
          {
            age: 0,
            type: 'csp-violation',
            url: 'http://localhost/console/',
            body: { effectiveDirective: 'font-src', blockedURL: 'https://x/y' },
          },
        ])
        .expect(204);
    });

    it('多余字段不会被 forbidNonWhitelisted 判 400（各家浏览器字段不一）', async () => {
      await request(app.getHttpServer())
        .post('/csp-report')
        .set('Content-Type', 'application/json')
        .send({ 'csp-report': { foo: 1 }, 未知字段: 'x' })
        .expect(204);
    });

    it('空对象与空数组只回 204，不抛错（端点公开，不能被一个畸形请求打出 500）', async () => {
      await request(app.getHttpServer())
        .post('/csp-report')
        .set('Content-Type', 'application/json')
        .send({})
        .expect(204);
      await request(app.getHttpServer())
        .post('/csp-report')
        .set('Content-Type', 'application/json')
        .send([])
        .expect(204);
    });

    it('顶层不是对象/数组时由 JSON 解析器挡在 400，不进业务代码', async () => {
      // body-parser 的 strict 模式只收对象与数组。浏览器不会发裸标量，
      // 所以这里 400 是可接受的；写成用例是为了固定「400 来自解析层」这个事实，
      // 免得日后有人看到 400 以为是 CspReportService 或 ValidationPipe 在拦。
      await request(app.getHttpServer())
        .post('/csp-report')
        .set('Content-Type', 'application/json')
        .send('"just a string"')
        .expect(400);
    });
  });

  afterEach(async () => {
    await app.close();
  });
});
