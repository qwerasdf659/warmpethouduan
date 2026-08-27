import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // 安全头 / body 解析 / 校验 / 异常 / WS 适配器：与 e2e 夹具共用同一份装配
  configureApp(app);

  // CORS：仅浏览器环境（后台前端、Unity WebGL 导出）才受此约束——
  // 原生 Unity（Android/iOS/Standalone）走 UnityWebRequest，不发 Origin、不校验 CORS，
  // 因此与这段配置无关，任何平台都能直连。
  //
  // 白名单来源合并两处：ADMIN_CORS_ORIGINS（后台前端）+ GAME_CORS_ORIGINS（游戏 WebGL 托管域）。
  // 任一非空即启用白名单；两者皆空且非生产环境时放开全部源，方便本地联调。
  const config = app.get(ConfigService);
  const corsOrigins = [
    ...(config.get<string[]>('admin.corsOrigins') ?? []),
    ...(config.get<string[]>('game.corsOrigins') ?? []),
  ];
  const isProd = config.get<string>('env') === 'production';
  if (corsOrigins.length > 0) {
    app.enableCors({ origin: corsOrigins, credentials: true });
  } else if (!isProd) {
    app.enableCors({ origin: true, credentials: true });
  }

  const port = config.get<number>('port') ?? 8080;
  // 监听 0.0.0.0 以匹配 DevBox 暴露端口（公网域名 → 8080）
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`warmpet-api listening on 0.0.0.0:${port}`);
}
void bootstrap();
