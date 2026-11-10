#!/usr/bin/env bash
# 服务器端收尾脚本（在 /var/www/english 里执行）
#   用法：bash deploy/update.sh
#
# ── 代码同步方式（2026-11-10 变更）──────────────────────────────────
# 由 GitHub Actions 主动 `git push` 到本机仓库，本机侧已设
#   receive.denyCurrentBranch = updateInstead
# 推送即更新工作区。**本脚本不再执行 git fetch / pull。**
#
# 为什么反方向：本机出口到 github.com 的 HTTPS 长期被掐 ——
#   实测 2026-11-10：TCP 443 可连，但 git fetch 从 09:08 挂到 09:14 无任何输出，
#   最终由人工 kill；旧版脚本的「5 次重试」对「无限挂起」无效（git 无默认超时）。
#   本机没有 deploy key，也无法改走 SSH（GitHub 侧添加需管理员权限）。
#   故把方向反过来：CI → 服务器，链路只用一条已证可用的 SSH。
# 早期版本（HTTPS 拉取）见 git 历史 commit 266cf2e 之前。
#
# 本脚本职责：权限归一 → nginx 配置校验 → 热重载。CI 推送成功后调用一次。
set -euo pipefail

SITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SITE_DIR"

echo "== 当前版本 =="
git log --oneline -1

# 站点只读交给 nginx：文件属主 root，644/755 足够。
# 但 *.sh 必须保留可执行位 —— 否则本脚本会把自己刷成 644，
# 服务器 git status 每次都多一条 ` M deploy/update.sh`（纯 mode 变化）。
find . -path ./.git -prune -o -type f -print0 | xargs -0 chmod 644
find . -path ./.git -prune -o -type f -name '*.sh' -print0 | xargs -0 chmod 755
find . -path ./.git -prune -o -type d -print0 | xargs -0 chmod 755

nginx -t
systemctl reload nginx
systemctl is-active nginx

# ── 上线自检：2b 磁盘真身 + 2c 经 vhost 取回 ─────────────────────────────
# 只验「磁盘上换了」（2b）会给出假阳性：文件可能落在 nginx 并不服务的目录里。
# 唯一能证明「nginx 服务的确实是本目录」的办法，是带 SNI 走回环把首页取回来，
# 与磁盘字节逐字比对。
#
# 为什么回环可行（2026-11-10 实测，纠正旧注释）：
#   带 --resolve 指定域名 → curl 用正确 SNI 握手，走 127.0.0.1:443 命中本站 vhost，
#   实测 http=200 且 md5 与磁盘一致（f32b90d3804bfb22e20e3f7c1d9c3b18）。
#   会失败的是**不带域名**的 https://127.0.0.1（无匹配 server_name，SNI 也缺），
#   那是预期行为，不代表回环不可用。
#
# 用 -L 是因为可能存在规范化跳转（如 /→index.html 或 www 收敛），
# 跟随后的最终响应体才是真正发给浏览器的字节。
SITE_DOMAIN="www.english.power-knowledge.tech"
disk_md5=$(md5sum index.html | awk '{print $1}')
_tmp_body=$(mktemp)
live_code=$(curl -skL -m 15 --resolve "$SITE_DOMAIN:443:127.0.0.1" \
  -o "$_tmp_body" -w '%{http_code}' "https://$SITE_DOMAIN/") || live_code="000"
live_md5=$(md5sum "$_tmp_body" | awk '{print $1}')
rm -f "$_tmp_body"

echo "== 上线自检 =="
echo "  http      : $live_code"
echo "  磁盘 md5  : $disk_md5"
echo "  经 vhost  : $live_md5"

if [ "$live_code" != "200" ] || [ "$disk_md5" != "$live_md5" ]; then
  echo "!! 自检失败：nginx 服务的不是本目录，或站点未正常返回" >&2
  echo "!! 排查：nginx -T | grep -n 'root ' 核对 vhost 的 root 是否为 $SITE_DIR" >&2
  exit 1
fi
echo "  自检通过：nginx 服务的正是本目录"
echo "== done =="
