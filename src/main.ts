import { NestFactory } from '@nestjs/core';
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

  const port = parseInt(process.env.PORT ?? '8080', 10);
  // 监听 0.0.0.0 以匹配 DevBox 暴露端口（公网域名 → 8080）
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`warmpet-api listening on 0.0.0.0:${port}`);
}
void bootstrap();
