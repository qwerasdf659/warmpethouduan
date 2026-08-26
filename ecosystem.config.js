/**
 * PM2 进程编排配置 · warmpet-api（微信小游戏宠物养成后端）
 *
 * 部署模型：PM2 常驻 Sealos DevBox（不走「发布打包镜像」路线）。
 *   - PostgreSQL：Sealos 托管实例（核心持久数据）
 *   - Redis：DevBox 本机，由 PM2 前台守护 + AOF 持久化（锁/缓存/幂等/排行）
 *
 * 用法：
 *   生产：  npm run build && pm2 start ecosystem.config.js
 *   开发：  pm2 start ecosystem.config.js --only redis-server   # 只起本机 Redis
 *           npm run start:dev                                    # 应用用热重载
 *
 * 依据：docs/08-前后端技术框架与路线.md、docs/10-后端MVP实现方案（待评审）.md
 */

module.exports = {
  apps: [
    {
      // Nest 应用（编译产物）
      name: 'warmpet-api',
      script: 'dist/main.js',
      cwd: '/home/devbox/project',

      // 所有配置来自 .env（单一真相源）：PORT / DB_* / REDIS_URL / JWT_* / WECHAT_*
      env_file: '.env',

      /*
       * MVP 阶段先单实例（fork 等价）。要开 cluster 多实例前，须先满足：
       *   - 定时任务只在单 worker 执行（isCronWorker 守卫）
       *   - 幂等/去重走 Redis（而非进程内内存）
       *   - WebSocket 走 Redis adapter（多进程推送一致）
       * 否则多进程会重复执行任务 / 重复推送。
       */
      exec_mode: 'cluster',
      instances: 1,

      watch: false,
      ignore_watch: ['node_modules', 'logs', '*.log'],

      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '1024M',

      kill_timeout: 5000,
      listen_timeout: 3000,

      out_file: './logs/warmpet-api-out.log',
      error_file: './logs/warmpet-api-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss [+08:00]',
      time: true,
    },
    {
      /*
       * 本机 Redis 守护进程
       * 关键点：
       *  - --daemonize no：前台运行，PM2 才能监控生命周期并在崩溃后 autorestart 拉起
       *    （DevBox 的 PID 1 是 dumb-init，无 systemd，裸跑 daemonize 崩了没人管）
       *  - --appendonly yes / --appendfsync everysec：AOF 持久化，数据落 project/ 目录
       *  - --bind 127.0.0.1：只监听本机，不对外暴露；与 .env REDIS_URL=redis://localhost:6379 对齐
       */
      name: 'redis-server',
      script: 'redis-server',
      args: '--port 6379 --bind 127.0.0.1 --dir /home/devbox/project --appendonly yes --appendfsync everysec --daemonize no --loglevel warning',
      cwd: '/home/devbox/project',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      min_uptime: '5s',
      watch: false,
      out_file: './logs/redis-out.log',
      error_file: './logs/redis-error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
