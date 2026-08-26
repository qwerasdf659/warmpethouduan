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
  // 连接池 / keepAlive（均可选，缺省走 configuration.ts 默认值）
  DB_POOL_MAX: Joi.number().min(1).default(20),
  DB_POOL_MIN: Joi.number().min(0).default(5),
  DB_POOL_ACQUIRE_MS: Joi.number().min(1000).default(10000),
  DB_POOL_IDLE_MS: Joi.number().min(1000).default(60000),
  DB_KEEPALIVE: Joi.boolean().truthy('true').falsy('false').default(true),
  DB_KEEPALIVE_DELAY_MS: Joi.number().min(0).default(10000),

  // Redis（本机）
  REDIS_URL: Joi.string().required(),

  // JWT
  JWT_SECRET: Joi.string().min(16).required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),

  // 后台管理端
  ADMIN_JWT_EXPIRES_IN: Joi.string().default('1d'),
  ADMIN_INIT_USERNAME: Joi.string().default('admin'),
  ADMIN_INIT_PASSWORD: Joi.string().allow('').default(''),
  ADMIN_CORS_ORIGINS: Joi.string().allow('').default(''),

  // 微信小游戏
  WECHAT_APPID: Joi.string().required(),
  WECHAT_SECRET: Joi.string().required(),
  /**
   * 小程序代码上传私钥的路径（对应 `secrets/private.wx*.key`）。
   *
   * ⚠ 本服务的运行时代码**不读它**，grep 不到消费方是正常的。它属于发版链路
   * （miniprogram-ci / 微信开发者工具上传），密钥文件本身不可再生——微信平台
   * 只在生成时给一次下载机会，删了要重新生成并重配 CI。所以此处只做存在性
   * 校验与说明，不要因为"没人用"而清理。
   */
  WECHAT_UPLOAD_PRIVATE_KEY_PATH: Joi.string().optional(),
  /**
   * 联调开关：允许用 `mock:<标识>` 形式的假 code 直接换取 JWT，免真机拿 code。
   * 这是一条**鉴权绕过**路径，生产环境显式禁止——配成 true 直接拒绝启动，
   * 而不是静默忽略（静默忽略会让误配一直潜伏到出事）。
   */
  WECHAT_MOCK_LOGIN: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(false)
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.valid(false).messages({
        'any.only':
          'WECHAT_MOCK_LOGIN 禁止在生产环境开启（该开关会绕过微信鉴权）',
      }),
    }),

  /**
   * Sealos 对象存储（S3 兼容）。**预留，当前无代码消费方。**
   *
   * 保留原因：宠物形象/装扮图资最终要走对象存储，而这几个值是 Sealos 控制台
   * 生成的成对凭证，散落在环境里比重新申请一遍便宜。等真正接入上传时，把用到
   * 的那几项从 optional 改 required，届时校验才有意义——现在设成 required 只会
   * 让本地起不来。
   */
  SEALOS_BUCKET: Joi.string().optional(),
  SEALOS_BUCKET_ACL: Joi.string().optional(),
  SEALOS_ACCESS_KEY: Joi.string().optional(),
  SEALOS_SECRET_KEY: Joi.string().optional(),
  SEALOS_INTERNAL_ENDPOINT: Joi.string().optional(),
  SEALOS_EXTERNAL_ENDPOINT: Joi.string().optional(),
  SEALOS_REGION: Joi.string().optional(),
}).unknown(true);
