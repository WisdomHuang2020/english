#!/usr/bin/env bash
# 服务器端更新脚本（在 /var/www/english 里执行）
#   用法：bash deploy/update.sh
# 零构建站：仓库根即发布产物，pull 完直接生效，不需要 npm build。
set -euo pipefail

SITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SITE_DIR"

echo "== 更新前版本 =="
git log --oneline -1

# 服务器出口到 GitHub 时不时被掐（GnuTLS recv error / 443 连接超时），
# 实测「失败 → 隔几秒重试」第二次通常就通，所以这里必须带重试，别一次失败就报错。
ok=0
for i in 1 2 3 4 5; do
  if git fetch --prune origin; then ok=1; break; fi
  echo "fetch failed (attempt $i), retrying in 5s..."
  sleep 5
done
if [ "$ok" -ne 1 ]; then
  echo "ERROR: git fetch 连续 5 次失败，站点保持当前版本未动。" >&2
  exit 1
fi
git reset --hard origin/main

echo "== 更新后版本 =="
git log --oneline -1

# 站点只读交给 nginx：文件属主 root，644/755 足够
# 但 .sh 必须保留可执行位 —— 否则本脚本会把自己刷成 644，
# 每次部署后服务器 git status 都多一条 ` M deploy/update.sh`（纯 mode 变化）。
find . -path ./.git -prune -o -type f -print0 | xargs -0 chmod 644
find . -path ./.git -prune -o -type f -name '*.sh' -print0 | xargs -0 chmod 755
find . -path ./.git -prune -o -type d -print0 | xargs -0 chmod 755

nginx -t
systemctl reload nginx
echo "== done =="
# 说明：站内自检不在这里发 HTTPS 请求 —— 服务器出口带代理，且本机回环访问会
# 因 SNI/证书链报 unrecognized name，容易误判。线上验证统一从客户端做：
#   https://www.english.power-knowledge.tech/ 返回 200 且页脚 ICP 可见即为通过。
systemctl is-active nginx
