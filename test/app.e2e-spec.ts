import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppController } from './../src/app.controller';
import { AppService } from './../src/app.service';

// 只装配 AppController/AppService，避免在 CI 里拉起 Postgres/Redis 全量依赖。
describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    app = moduleFixture.createNestApplication();
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

  afterEach(async () => {
    await app.close();
  });
});
