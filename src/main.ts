import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { buildHelmetOptions, CspMode } from './common/security/helmet.options';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  /*
   * 反向代理跳数。决定 req.ip 取 socket 地址还是 X-Forwarded-For。
   *
   * 这不是可有可无的一行：后台登录频控按 IP 计数（LoginThrottleService），
   * 设成 0 时 Sealos ingress 后面的所有请求会共用 ingress 的那一个 IP，
   * 20 次失败就把全部管理员一起锁在门外。
   */
  app.set('trust proxy', parseInt(process.env.TRUST_PROXY_HOPS ?? '1', 10));

  const cspMode = (process.env.CSP_MODE ?? 'report-only') as CspMode;
  app.use(helmet(buildHelmetOptions(cspMode)));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  // CORS：后台前端若与 API 同源（构建产物挂 /admin）无需跨域；
  // 本地 dev（Umi/Vite dev server 独立端口）需放行。
  // 配了 ADMIN_CORS_ORIGINS 用白名单；否则仅在非生产环境放开。
  const config = app.get(ConfigService);
  const corsOrigins = config.get<string[]>('admin.corsOrigins') ?? [];
  const isProd = config.get<string>('env') === 'production';
  if (corsOrigins.length > 0) {
    app.enableCors({ origin: corsOrigins, credentials: true });
  } else if (!isProd) {
    app.enableCors({ origin: true, credentials: true });
  }

  const port = parseInt(process.env.PORT ?? '8080', 10);
  // 监听 0.0.0.0 以匹配 DevBox 暴露端口（公网域名 → 8080）
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`warmpet-api listening on 0.0.0.0:${port}`);
}
void bootstrap();
