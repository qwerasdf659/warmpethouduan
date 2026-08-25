import * as Joi from 'joi';

/**
 * 一个可调配置项的声明：默认值 + 校验规则 + 运营可读说明。
 *
 * 默认值同时承担两个角色：启动种子的初值，以及 DB 缺失/脏数据时的兜底。
 * 因此**默认值必须永远是合法的**——它是玩法不被脏配置打崩的最后一道防线。
 */
export interface ConfigEntry<T> {
  /** 后台配置页展示给运营看的说明 */
  description: string;
  /** 写入与加载都用这份 schema 校验 */
  schema: Joi.Schema;
  /** 代码内置默认值 */
  default: T;
}

/**
 * 声明一个配置项。存在的意义是让 TS 从 `default` 推断出 `T`，
 * 免得每个配置项都手写一遍类型参数。
 */
export function defineConfig<T>(entry: ConfigEntry<T>): ConfigEntry<T> {
  return entry;
}

/** 从「域配置项集合」推导出 key → 值类型的映射。 */
export type ShapeOf<R> = {
  [K in keyof R]: R[K] extends ConfigEntry<infer T> ? T : never;
};

// ------------------------------------------------------------------ 常用 schema

/** 非负整数（大量数值配置是「次数 / 币量 / 毫秒」这类） */
export const nonNegInt = Joi.number().integer().min(0);

/** 正整数 */
export const posInt = Joi.number().integer().min(1);

/**
 * 供运营填写的对象 schema 统一加 `.required()` 且禁止未知字段：
 * 运营少填一个字段就静默走 undefined 是很难查的线上事故，宁可写入时直接报错。
 */
export function strictObject(keys: Joi.SchemaMap): Joi.ObjectSchema {
  return Joi.object(keys).required().unknown(false);
}
