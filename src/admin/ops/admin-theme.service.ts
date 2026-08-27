import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as Joi from 'joi';
import { Repository } from 'typeorm';
import { AdminSetting } from '../../entities/admin-setting.entity';
import {
  ADMIN_THEME_DEFAULT,
  ADMIN_THEME_KEY,
  ADMIN_THEME_SCHEMA,
  AdminThemeSetting,
} from './admin-theme.config';

export interface AdminThemeView {
  theme: AdminThemeSetting;
  /** 当前值是否偏离代码默认值（外观设置页据此决定要不要给「恢复默认」） */
  modified: boolean;
  updatedAt: Date | null;
}

/**
 * 后台外观主题的读写。
 *
 * 读路径被每个管理员每次刷新都会走一遍，且**登录页也要用**，所以它必须
 * 永远返回一份可用的主题：DB 没有行、字段缺失、值被改脏，一律回落默认值
 * 而不是抛错——配色坏掉最多是难看，读主题抛错会让整个后台白屏。
 */
@Injectable()
export class AdminThemeService {
  private readonly logger = new Logger(AdminThemeService.name);

  constructor(
    @InjectRepository(AdminSetting)
    private readonly settings: Repository<AdminSetting>,
  ) {}

  async get(): Promise<AdminThemeView> {
    const row = await this.settings.findOne({
      where: { key: ADMIN_THEME_KEY },
    });
    if (!row) {
      return { theme: ADMIN_THEME_DEFAULT, modified: false, updatedAt: null };
    }

    const theme = this.normalize(row.value);
    return {
      theme,
      modified: !shallowEqual(theme, ADMIN_THEME_DEFAULT),
      updatedAt: row.updatedAt,
    };
  }

  async update(value: unknown): Promise<AdminThemeView> {
    // 标注成 ValidationResult<unknown> 而不是直接解构：joi 的 validate 出参是 any，
    // 解构出来会被 no-unsafe-assignment 拦下。与 GameConfigService.validate 同一写法。
    const result: Joi.ValidationResult<unknown> = ADMIN_THEME_SCHEMA.validate(
      value,
      { abortEarly: false, convert: true },
    );
    if (result.error) {
      throw new BadRequestException(`主题配置非法：${result.error.message}`);
    }
    // schema 是全量必填 + unknown(false)，过校验即等于该结构
    return this.save(result.value as AdminThemeSetting);
  }

  async reset(): Promise<AdminThemeView> {
    return this.save(ADMIN_THEME_DEFAULT);
  }

  private async save(theme: AdminThemeSetting): Promise<AdminThemeView> {
    let row = await this.settings.findOne({
      where: { key: ADMIN_THEME_KEY },
    });
    if (!row) {
      row = this.settings.create({ key: ADMIN_THEME_KEY, value: theme });
    } else {
      row.value = theme;
    }
    const saved = await this.settings.save(row);
    return {
      theme,
      modified: !shallowEqual(theme, ADMIN_THEME_DEFAULT),
      updatedAt: saved.updatedAt,
    };
  }

  /**
   * 存量值 → 可用主题。
   *
   * 先用默认值补齐再校验，这样**新增字段不需要数据迁移**：老行缺 `compact`
   * 时补上默认的 false，而不是整份配置判为非法、把运营辛苦调好的配色丢掉。
   */
  private normalize(stored: unknown): AdminThemeSetting {
    const merged = {
      ...ADMIN_THEME_DEFAULT,
      ...(stored && typeof stored === 'object' ? stored : {}),
    };
    const result: Joi.ValidationResult<unknown> = ADMIN_THEME_SCHEMA.validate(
      merged,
      { abortEarly: false, convert: true },
    );
    if (result.error) {
      this.logger.warn(
        `admin_setting.${ADMIN_THEME_KEY} 值非法，已回落默认主题：${result.error.message}`,
      );
      return ADMIN_THEME_DEFAULT;
    }
    return result.value as AdminThemeSetting;
  }
}

/** 主题是一层扁平结构（全是 string/number/boolean），不需要深比较。 */
function shallowEqual(a: AdminThemeSetting, b: AdminThemeSetting): boolean {
  return (Object.keys(b) as (keyof AdminThemeSetting)[]).every(
    (k) => a[k] === b[k],
  );
}
