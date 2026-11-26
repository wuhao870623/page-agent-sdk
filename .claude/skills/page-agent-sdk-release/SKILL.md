---
name: page-agent-sdk-release
description: Release a new version of the page-agent-sdk npm package and push to Gitee + the GitHub mirror. Use when the user wants to publish/ship a new version, bump the version, build + test before release, push to gitee or github, or follow the project's release checklist. Covers the full flow: code changes → sync zh/en docs → bump semver → build + self-test → commit → push Gitee + sync GitHub mirror → npm publish → verify.
---

# Release page-agent-sdk

Execute the project's release checklist end-to-end. The authoritative, detailed checklist lives in `CLAUDE.md` → "发布流程 checklist"; read that section first, then follow the steps below.

> ⚠️ **Do NOT auto-release**: after fixing a bug or adding a feature, do NOT automatically bump / push / publish. Stop and ask the user "是否发布?" first. Only run this checklist when the user explicitly says 发布 / publish / 推上去 / ship, etc.

## Dual remote + branch workflow (develop → master)

| remote | URL | role |
|---|---|---|
| `origin` | gitee.com/whyymj/**chat-agent**.git | primary remote (develop granular commits + master release commits); `scripts/publish.sh` pushes here |
| `github` | github.com/wuhao870623/**page-agent-sdk**.git | GitHub mirror, pushed by hand; every GitHub link in `README.md` / `README.zh-CN.md` / `package.json` (`homepage` / `repository` / `bugs`) points here |

> History: the GitHub channel was **retired 2026-09-28** (old `whyymj` GitHub account unreachable; its repo `whyymj/page-agent-sdk` is public but read-only for us) and **restored 2026-11-26** under the `wuhao870623` account. SSH auth uses `~/.ssh/id_ed25519_github` (bound to `wuhao870623` — not the npm/Gitee `whyymj` account); behind a proxy, SSH port 22 sometimes fails with `Connection closed` — retry. `scripts/publish.sh` still pushes Gitee only.

**Branch workflow**: daily dev happens on `develop` (granular commits, `git push origin develop`). At release, on `master` run `./scripts/publish.sh "release x.x.x: summary"` — it `merge --squash develop` into one release commit, fast-forwards Gitee's `master`, then rebuilds `develop` = `master` (drops the already-squashed commits so the next release doesn't re-squash them). `master` is only touched at release. **The default branch on both remotes is `master`** — the README shown on the repo homepage, and the README + sidebar links on npmjs.com, only pick up doc changes at release.

Personal notes (`doc/待确认问题.md`) are gitignored (untracked) — never committed.

## Release checklist (in order)

0. **Work on `develop`** (never `master`): `git checkout develop` first if on master. Commit code changes here, `git push origin develop` anytime (mirror when convenient: `git push github develop`).
1. **Code**: edit `src/`, sync `types/index.d.ts` (hand-maintained), update exports in `src/core/index.ts`. **新增功能必须同步补对应测试用例**(selftest 和/或 e2e,见 `CLAUDE.md` → "测试流程 → 新增功能测试同步约定"),与功能代码同 commit,无测试不予发布。
2. **Docs (sync zh + en, never single-side)**:
   - `README.md` (en) / `README.zh-CN.md` (zh) — features, usage, scenarios
   - `doc/README.md` (zh) / `doc/README.en.md` (en) — doc index
   - `doc/usage-guide.md` (zh) / `doc/usage-guide.en.md` (en) — usage guide
   - `CLAUDE.md` — internal dev guide/architecture
   - `CHANGELOG.md` — add this version's entry (Keep a Changelog style; new version section under `[Unreleased]`, categorize Added/Changed/Fixed/Removed)
   - Keep language toggle links bidirectional.
3. **Bump version**: `npm version patch|minor|major --no-git-tag-version` (semver: minor for new API, major for breaking, patch for fix). Never republish the same version.
4. **Build + self-test**: `npm run build` (= `build:lib` + `build:iife`) then `npm test` then `npm run test:e2e` (uses built `dist`). **Assertion counts must match the current `CLAUDE.md` → "测试流程"** (run `node scripts/check-test-counts.mjs` to cross-check). Run `npm pack --dry-run` to confirm the tarball excludes `.env` / `src` / `examples` / notes.
5. **Commit** (on `develop`): `git add -A && git commit -m "feat/fix/docs: ..."` (conventional style). Daily pushes go to `git push origin develop`.
6. **Release to `master` + push Gitee + sync GitHub mirror**: `git checkout master` → `./scripts/publish.sh "release x.x.x: one-line summary"` — squashes `develop` into one release commit, fast-forward pushes Gitee, rebuilds `develop`. Then sync the mirror: `git push github master && git push --force-with-lease github develop` (`develop` was rebuilt by the script, so a plain push is rejected as non-fast-forward). Back to `git checkout develop` (the script ends on `develop` already).
7. **Publish to npm**: `npm publish` (`publishConfig.registry` is locked to the official npm registry, unaffected by the machine's default private registry).
8. **Verify**: `npm view page-agent-sdk version` (confirm latest; fresh publishes may sit in npm's **staged** queue for several minutes — a duplicate `npm publish` returning `E409 Cannot publish over previously staged version` means it landed, just wait and re-check) + a temp dir `npm i page-agent-sdk@<ver>` and **actually invoke this release's new exports in node** (not just a successful install) + CDN reachability (`curl -sL https://esm.sh/page-agent-sdk@<ver>`) + the npm page sidebar (Homepage / Repository / Issues must point to `github.com/wuhao870623/page-agent-sdk`).

## npm credentials gotchas

- Account `whyymj` has 2FA enabled. Use a **token with 2FA bypass** (npmjs.com → Access Tokens: Classic → Automation, or Granular → check "Bypass two-factor authentication" + scope `page-agent-sdk` with Read and write); write to user-level `~/.npmrc` via `npm config set //registry.npmjs.org/:_authToken <token> --location=user`. **Never paste the token into chat** (it lands in the session log) — configure it in an external terminal and revoke it right after publishing. Never commit tokens or store them in the project dir.
- `npm login` / `npm whoami` require `--registry=https://registry.npmjs.org/` (machine default may be a private registry).

## References

- `CLAUDE.md` → "发布流程 checklist" / "双远程仓库" / "npm 发布约定" — authoritative details.
- `package.json` → `publishConfig`, `exports`, `files`, `peerDependencies`.
