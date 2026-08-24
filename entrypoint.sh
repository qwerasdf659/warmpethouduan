#!/bin/bash
# warmpet-api 启动入口
# 部署模型：PM2 常驻 DevBox（生产由 pm2 start ecosystem.config.js 拉起 app + 本机 redis）。
# 本脚本用于 DevBox「运行」按钮 / 手动启动的兜底路径。

set -e

app_env=${1:-development}

if [ "$app_env" = "production" ] || [ "$app_env" = "prod" ]; then
    echo "Production environment detected"
    # 生产：确保已构建，运行编译产物
    if [ ! -f "dist/main.js" ]; then
        echo "dist/main.js 不存在，先执行构建..."
        npm run build
    fi
    NODE_ENV=production node dist/main.js
else
    echo "Development environment detected"
    # 开发：热重载（需另行启动本机 Redis：pm2 start ecosystem.config.js --only redis-server）
    NODE_ENV=development npm run start:dev
fi
