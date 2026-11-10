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
echo "== done =="

# 说明：站内自检不在这里发 HTTPS 请求 —— 服务器出口带代理，且本机回环访问会
# 因 SNI/证书链报 unrecognized name，容易误判。线上验证统一从客户端做：
#   https://www.english.power-knowledge.tech/ 返回 200 且页脚 ICP 可见即为通过。
