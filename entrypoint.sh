#!/bin/bash
# warmpet-api 启动入口
# 部署模型：PM2 常驻 DevBox（守护 Nest 应用 + 本机 Redis）。
# 生产/发布：用 pm2-runtime 前台托管整个 ecosystem（容器主进程，崩溃自动重启）。

set -e

app_env=${1:-development}
cd "$(dirname "$0")"

if [ "$app_env" = "production" ] || [ "$app_env" = "prod" ]; then
    echo "Production environment detected"
    # 确保已构建
    if [ ! -f "dist/main.js" ]; then
        echo "dist/main.js 不存在，先执行构建..."
        npm run build
    fi
    # pm2-runtime 前台运行：作为容器主进程守护 app + 本机 redis
    export NODE_ENV=production
    exec pm2-runtime start ecosystem.config.js
else
    echo "Development environment detected"
    # 开发：先用 PM2 起本机 Redis（幂等，已在则跳过），应用用热重载
    pm2 start ecosystem.config.js --only redis-server >/dev/null 2>&1 || true
    NODE_ENV=development npm run start:dev
fi
