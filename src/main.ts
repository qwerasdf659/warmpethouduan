import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
