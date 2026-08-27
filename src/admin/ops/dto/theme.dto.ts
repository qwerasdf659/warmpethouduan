import { Allow } from 'class-validator';

/**
 * 外观主题更新。用信封包一层而不是直接收扁平对象：全局 ValidationPipe 开了
 * `forbidNonWhitelisted`，裸对象的每个字段都得再声明一遍 class-validator 规则，
 * 与 `AdminThemeService` 里的 Joi schema 形成两份会走样的真相。这里放行整块
 * JSON，字段校验统一交给 Joi。
 */
export class UpdateThemeDto {
  @Allow()
  theme: unknown;
}
