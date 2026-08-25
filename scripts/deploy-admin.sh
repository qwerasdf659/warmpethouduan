#!/bin/bash
# 一键部署：前端 admin-web 构建 → 后端构建 → PM2 重启
# 用法：bash scripts/deploy-admin.sh   或   npm run deploy
set -euo pipefail

# 切到项目根（脚本在 scripts/ 下）
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
echo "项目根：$ROOT"

echo "[1/3] 构建前端 admin-web ..."
cd "$ROOT/admin-web"
pnpm install --prefer-offline
pnpm build

echo "[2/3] 构建后端 ..."
cd "$ROOT"
npm run build

echo "[3/3] 重启 PM2（warmpet-api）..."
if npx pm2 describe warmpet-api >/dev/null 2>&1; then
  npx pm2 restart warmpet-api --update-env
else
  echo "PM2 中无 warmpet-api 进程，改用 ecosystem 启动 ..."
  npx pm2 start ecosystem.config.js
fi

echo "✅ 部署完成。后台地址：<域名>/console ；API：/auth/admin、/admin"
