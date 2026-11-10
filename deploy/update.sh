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
# 说明：站内自检不在这里发 HTTPS 请求 —— 服务器出口带代理，且本机回环访问会
# 因 SNI/证书链报 unrecognized name，容易误判。线上验证统一从客户端做：
#   https://english.power-knowledge.tech/ 返回 200 且页脚 ICP 可见即为通过。
systemctl is-active nginx
