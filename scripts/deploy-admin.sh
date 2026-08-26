#!/bin/bash
# 唯一部署入口：构建（前端 + 后端）→ 跑迁移 → 重启 PM2。
# 用法：npm run deploy   或   bash scripts/deploy-admin.sh
#
# 构建不在这里重写一遍，直接复用 `npm run build:all`——此前本脚本自己 cd 进
# admin-web 手搓了一套 pnpm install/build，和 build:all 是两份要手动同步的同义实现。
#
# 迁移必须在「构建之后、重启之前」：本项目 synchronize:false 且没开 migrationsRun，
# 迁移只能显式跑。少了这一步，改过实体的版本会带着旧表结构起来，
# 直到第一个请求打到新列才炸。
set -euo pipefail

cd "$(dirname "$0")/.."
echo "项目根：$(pwd)"

echo "[1/3] 构建前端 + 后端 ..."
npm run build:all

echo "[2/3] 执行数据库迁移 ..."
npm run migration:run

echo "[3/3] 重启 PM2（warmpet-api）..."
if npx pm2 describe warmpet-api >/dev/null 2>&1; then
  npx pm2 restart warmpet-api --update-env
else
  echo "PM2 中无 warmpet-api 进程，改用 ecosystem 启动 ..."
  npx pm2 start ecosystem.config.js
fi

echo "✅ 部署完成。后台地址：<域名>/console ；API：/admin"
