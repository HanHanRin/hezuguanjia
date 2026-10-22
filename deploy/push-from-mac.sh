#!/usr/bin/env bash
# 从本机把合租生活管家部署到阿里云（小内存服务器：本机构建，服务器只解压、装零依赖的生产包）。
# 前置：已完成 ssh root@139.224.220.27 的密钥授权。
#   bash deploy/push-from-mac.sh
set -euo pipefail

HOST="${DEPLOY_HOST:-139.224.220.27}"
LOGIN_USER="${DEPLOY_USER:-root}"
REMOTE_DIR="${DEPLOY_APP_DIR:-/var/www/hezuguanjia}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCHIVE="/tmp/hezuguanjia-$(date +%Y%m%d-%H%M%S).tgz"

CONTROL="${HOME}/.ssh/cm-hz-%r@%h:%p"
cleanup() { ssh -o ControlPath="$CONTROL" -O exit "${LOGIN_USER}@${HOST}" 2>/dev/null || true; }
trap cleanup EXIT

echo "==> 本机构建（服务器只有 1.6GB 内存，不在上面跑构建）"
cd "$ROOT"
npm run build:server
npm test

echo "==> 打包运行所需文件"
tar czf "$ARCHIVE" \
  --exclude '.env' \
  --exclude '.env.local' \
  --exclude 'data' \
  --exclude 'node_modules' \
  package.json server core dist index.html vite.config.js deploy/ecosystem.config.cjs deploy/nginx.hezuguanjia.conf README.md
trap 'rm -f "$ARCHIVE"; cleanup' EXIT

echo "==> 建立 SSH 会话"
mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"
ssh -o BatchMode=yes -o ConnectTimeout=10 -o ControlMaster=yes -o ControlPath="$CONTROL" -o ControlPersist=600 -o StrictHostKeyChecking=yes -fN "${LOGIN_USER}@${HOST}"
RSYNC_SSH="ssh -o BatchMode=yes -o ControlPath=$CONTROL"

echo "==> 上传并安装到 ${REMOTE_DIR}"
rsync -az -e "$RSYNC_SSH" "$ARCHIVE" "${LOGIN_USER}@${HOST}:/tmp/hezuguanjia-new.tgz"
ssh -o BatchMode=yes -o ControlPath="$CONTROL" "${LOGIN_USER}@${HOST}" "REMOTE_DIR='$REMOTE_DIR' ARCHIVE='$ARCHIVE' bash -s" <<'REMOTE'
set -euo pipefail
mkdir -p "$REMOTE_DIR" /var/log/hezuguanjia
cd "$REMOTE_DIR"
# 备份当前版本（只保留最近 3 份）
if [ -d server ] || [ -d dist ]; then
  tar czf "/var/www/hezuguanjia-backup-$(date +%Y%m%d-%H%M%S).tgz" server core dist package.json 2>/dev/null || true
  ls -1t /var/www/hezuguanjia-backup-*.tgz 2>/dev/null | tail -n +4 | xargs -r rm -f
fi
tar xzf /tmp/hezuguanjia-new.tgz
rm -f /tmp/hezuguanjia-new.tgz
# .env 已存在就保留；没有就创建（AI 留空，应用仍可正常使用）
if [ ! -f .env ]; then
  cat > .env <<'ENV'
PORT=4330
HOST=127.0.0.1
BASE_PATH=/hezuguanjia
DATA_DIR=/var/www/hezuguanjia/data
AI_DAILY_LIMIT=50
AI_DEMO_DAILY_LIMIT=10
ENV
fi
# 沿用作品集的 DeepSeek 密钥（服务器上的同一把 OpenAI 兼容 key）
if ! grep -q '^AI_API_KEY=' .env && [ -f /var/www/yuhaipei/web/.env.local ]; then
  set -a; . /var/www/yuhaipei/web/.env.local; set +a
  {
    echo "AI_BASE_URL=${DEEPSEEK_BASE_URL:-https://api.deepseek.com}"
    echo "AI_API_KEY=${DEEPSEEK_API_KEY}"
    echo "AI_MODEL=deepseek-v4-pro"
    echo "AI_VISION_MODEL=deepseek-flash"
    echo "AI_DISABLE_THINKING=1"
  } >> .env
fi
node --check server/index.js
# Nginx：把 /hezuguanjia/ 加进默认站点（先备份到 sites-available，备份文件放在 sites-enabled 会被当成配置加载）
if [ -f /etc/nginx/sites-enabled/yuhaipei ] && ! grep -q 'location /hezuguanjia/' /etc/nginx/sites-enabled/yuhaipei; then
  ts=$(date +%Y%m%d-%H%M%S)
  cp -L /etc/nginx/sites-enabled/yuhaipei "/etc/nginx/sites-available/yuhaipei.bak.$ts"
  install -m 644 deploy/nginx.hezuguanjia.conf /etc/nginx/sites-available/hezuguanjia
  rm -f /etc/nginx/sites-enabled/yuhaipei
  ln -sf /etc/nginx/sites-available/hezuguanjia /etc/nginx/sites-enabled/yuhaipei
  nginx -t
  systemctl reload nginx
fi
# PM2
pm2 delete hezuguanjia 2>/dev/null || true
pm2 start deploy/ecosystem.config.cjs
pm2 save
sleep 2
curl --fail -sS -o /dev/null -w 'health → HTTP %{http_code}\n' http://127.0.0.1:4330/hezuguanjia/api/health
REMOTE

echo "完成：https://yuhaipei.cn/hezuguanjia/"
