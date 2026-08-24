import * as Joi from 'joi';

/**
 * 环境变量校验（fail-fast）：缺失/非法则应用启动即报错退出，
 * 避免「开发能跑、生产炸」。unknown(true) 允许存在未声明的额外变量。
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'staging', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(8080),
  TZ: Joi.string().default('Asia/Shanghai'),

  // PostgreSQL（托管）
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().default(5432),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  DB_EXTERNAL_URL: Joi.string().allow('').optional(),

  // Redis（本机）
  REDIS_URL: Joi.string().required(),

  // JWT
  JWT_SECRET: Joi.string().min(16).required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),

  // 微信小游戏
  WECHAT_APPID: Joi.string().required(),
  WECHAT_SECRET: Joi.string().required(),
  WECHAT_UPLOAD_PRIVATE_KEY_PATH: Joi.string().optional(),

  // Sealos 对象存储（M1 可选，后期用到再置为 required）
  SEALOS_BUCKET: Joi.string().optional(),
  SEALOS_BUCKET_ACL: Joi.string().optional(),
  SEALOS_ACCESS_KEY: Joi.string().optional(),
  SEALOS_SECRET_KEY: Joi.string().optional(),
  SEALOS_INTERNAL_ENDPOINT: Joi.string().optional(),
  SEALOS_EXTERNAL_ENDPOINT: Joi.string().optional(),
  SEALOS_REGION: Joi.string().optional(),
}).unknown(true);
