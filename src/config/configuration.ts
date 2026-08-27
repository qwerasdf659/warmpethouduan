export default () => ({
  env: process.env.NODE_ENV ?? 'development',
  // 监听端口。对齐 DevBox 暴露端口（本项目 8080）
  port: parseInt(process.env.PORT ?? '8080', 10),
  /*
   * 运行时装配用的两项（`bootstrap.ts` 消费）。
   *
   * 放进 configuration 而不是在 bootstrap 里直接读 process.env：裸读会绕开
   * ConfigModule 的 Joi 校验，于是 `CSP_MODE=enfoce` 这种拼写错误不会在启动时
   * 被拦下，而是安静地退化成默认档——安全配置最忌讳的就是「配错了也不报错」。
   */
  trustProxyHops: parseInt(process.env.TRUST_PROXY_HOPS ?? '1', 10),
  cspMode: process.env.CSP_MODE ?? 'report-only',
  db: {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    name: process.env.DB_NAME,
    // 连接池 / keepAlive（对齐 pg Pool 语义，全部可用 env 覆盖）
    pool: {
      // 每进程最大连接数；PM2 cluster 下按「每 worker 各一份」估算总量
      max: parseInt(process.env.DB_POOL_MAX ?? '20', 10),
      // 最小连接（pg 为软下限，减少冷启动握手）
      min: parseInt(process.env.DB_POOL_MIN ?? '5', 10),
      // 获取连接超时（对应 Sequelize 的 pool.acquire）
      connectionTimeoutMs: parseInt(
        process.env.DB_POOL_ACQUIRE_MS ?? '10000',
        10,
      ),
      // 空闲连接回收（对应 Sequelize 的 pool.idle）
      idleTimeoutMs: parseInt(process.env.DB_POOL_IDLE_MS ?? '60000', 10),
      // TCP keepAlive：秒级探测被网关/NAT 静默掐断的半开连接
      keepAlive: (process.env.DB_KEEPALIVE ?? 'true') !== 'false',
      keepAliveInitialDelayMs: parseInt(
        process.env.DB_KEEPALIVE_DELAY_MS ?? '10000',
        10,
      ),
    },
  },
  redis: {
    url: process.env.REDIS_URL,
  },
  // 粗粒度限流的兜底额度。注意 @nestjs/throttler 把 handler 名一起哈希进计数键，
  // 因此额度是「每 IP 每端点每窗口」而非全站合计——调这个数时别按总 QPS 估算。
  // 登录端点另有更紧的上限，写死在 admin-auth.controller.ts 的 @Throttle 上。
  throttle: {
    ttlMs: parseInt(process.env.THROTTLE_TTL_MS ?? '60000', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  },
  admin: {
    // 后台 JWT 时效（比玩家端短，降低泄露风险）
    jwtExpiresIn: process.env.ADMIN_JWT_EXPIRES_IN ?? '1d',
    // 初始超管账号（仅在库内无任何管理员时用于播种；播种后建议改密并清空）
    initUsername: process.env.ADMIN_INIT_USERNAME ?? 'admin',
    initPassword: process.env.ADMIN_INIT_PASSWORD ?? '',
    // 允许跨域的前端源（逗号分隔）；为空则开发放开、生产同源
    corsOrigins: (process.env.ADMIN_CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
  game: {
    // 游戏前端（Unity WebGL 导出）托管域的 CORS 白名单，逗号分隔。
    // 与 admin.corsOrigins 分开配置：二者用途不同，避免把后台域和游戏域混为一谈。
    // 原生 Unity 无需配置（不走 CORS）。
    corsOrigins: (process.env.GAME_CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    // 通用登录（设备/账号）总开关。默认开启，让非微信平台（Unity 原生/Steam 等）能取得 JWT；
    // 纯微信小游戏部署可置 false 收紧攻击面，仅保留微信 code 登录。
    genericLoginEnabled:
      (process.env.AUTH_GENERIC_LOGIN_ENABLED ?? 'true') !== 'false',
  },
  wechat: {
    appid: process.env.WECHAT_APPID,
    secret: process.env.WECHAT_SECRET,
    /**
     * 假登录开关。生产环境**永远为 false**：即便 env 误配，这里也再兜一层，
     * 与 env.validation 的启动期拒绝构成双保险（配置校验可能被 unknown 变量绕过，
     * 但这一层是代码硬约束）。
     */
    mockLogin:
      (process.env.WECHAT_MOCK_LOGIN ?? 'false') === 'true' &&
      (process.env.NODE_ENV ?? 'development') !== 'production',
  },
});
