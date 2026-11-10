#!/usr/bin/env bash
# 服务器端更新脚本（在 /var/www/english 里执行）
#   用法：bash deploy/update.sh
# 零构建站：仓库根即发布产物，pull 完直接生效，不需要 npm build。
set -euo pipefail

SITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SITE_DIR"

echo "== 更新前版本 =="
git log --oneline -1

git fetch --prune origin
git reset --hard origin/main

echo "== 更新后版本 =="
git log --oneline -1

# 站点只读交给 nginx：文件属主 root，644/755 足够
find . -path ./.git -prune -o -type f -print0 | xargs -0 chmod 644
find . -path ./.git -prune -o -type d -print0 | xargs -0 chmod 755

nginx -t
systemctl reload nginx
echo "== done =="
# 本机自检：必须用 --resolve，否则 SNI 不带域名，通配证会报 unrecognized name
curl -sS -o /dev/null -w 'local https=%{http_code}\n' \
  --resolve english.power-knowledge.tech:443:127.0.0.1 \
  https://english.power-knowledge.tech/
