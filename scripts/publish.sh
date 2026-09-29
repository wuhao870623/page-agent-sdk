#!/usr/bin/env bash
# 发布到 master(总结 develop)并推送 Gitee
# 工作流:
#   - 日常新功能在 develop 分支维护(细粒度 commit,git push origin develop)
#   - 发布时:在 master 上 merge --squash develop 总结成一个发布 commit → push origin master
#     (master 只含发布 commit,历史干净)
#   - 发布后:重建 develop = master(丢弃已被 squash 的 develop commit,防下次重复 squash)
# 约定:
#   - 个人笔记 doc/待确认问题.md 在 .gitignore 未跟踪,不提交
#   - GitHub 分发通道已停用(2026-09-28):单远程 Gitee;若恢复,历史版 scripts/publish-github.sh 可从 git 找回
# 用法:
#   ./scripts/publish.sh "release x.x.x: 一句话总结"   # 推荐:参数作发布 commit message
#   ./scripts/publish.sh                               # 默认 message "release: publish from develop"
set -euo pipefail

REMOTE=origin
BRANCH_DEVELOP=develop
BRANCH_MASTER=master
NOTE_FILE="doc/待确认问题.md"

# 1. 工作区必须干净
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "❌ 工作区有未提交改动,请先 commit 或 stash"; exit 1
fi

# 2. 确认当前在 master(发布在 master 上进行;日常开发在 develop)
if [ "$(git branch --show-current)" != "$BRANCH_MASTER" ]; then
  echo "❌ 请先切换到 $BRANCH_MASTER 分支发布(当前:$(git branch --show-current));日常开发请在 $BRANCH_DEVELOP"; exit 1
fi

# 3. 同步远程引用
git fetch "$REMOTE" --quiet

# 4. develop 领先 master?若领先则 squash 总结成一个发布 commit
AHEAD_DEV=$(git rev-list --count "$BRANCH_MASTER..$BRANCH_DEVELOP" || true)
if [ "${AHEAD_DEV:-0}" -gt 0 ]; then
  echo "📦 develop 领先 master $AHEAD_DEV 个提交,合并总结:"
  git log --oneline "$BRANCH_MASTER..$BRANCH_DEVELOP"
  git merge --squash "$BRANCH_DEVELOP"
  if git diff --cached --quiet; then
    # develop 内容已在 master(上次发布后未重建 develop)→ 跳过空 commit,仅对齐
    echo "ℹ️  develop 内容已全部在 master,跳过空 commit(仅做对齐)"
  else
    git rm --cached "$NOTE_FILE" >/dev/null 2>&1 || true
    if [ $# -gt 0 ]; then
      git commit -m "$*"
    else
      git commit -m "release: publish from develop"
    fi
  fi
else
  echo "ℹ️  develop 无领先 master 的提交"
fi

# 5. 推 master(fast-forward)
git push "$REMOTE" "$BRANCH_MASTER"

# 6. 重建 develop = master(squash 不建立父子关系,不重建则 develop 原始 commit 永远「领先」master,下次重复 squash)
git branch -f "$BRANCH_DEVELOP" "$BRANCH_MASTER"
git push --force "$REMOTE" "$BRANCH_DEVELOP"
git checkout "$BRANCH_DEVELOP"
echo "✅ 已发布到 Gitee($REMOTE)。develop 已重建对齐 master,当前在 develop,继续开发"
