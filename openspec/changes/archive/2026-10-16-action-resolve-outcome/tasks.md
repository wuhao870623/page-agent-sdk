# Tasks: 2026-10-16-action-resolve-outcome

## 1. 核心通道

- [x] 1.1 `src/core/sdk/actionOutcome.ts`(新):`createActionOutcomeChannel({ deferredNames, emit, log })` → `{ resolve(name, outcome, detail?), notices, clear }`;严格门禁(非 deferred/未知名返 false + warn)/ 名字键覆盖 / 幂等(同名字已裁决返 false)/ 去重 + 封顶 5;debugLogs stage `action_resolved` + 事件 `action_resolved`(name/outcome/detail)
- [x] 1.2 `src/core/sdk/createChatSdk.ts`:装配期有任一 `deferredWrite` 动作 → 建通道 + 装 `actionNotice` 中间件(augmentPrompt 只读 notices 注段 / afterAgent 清空;sdk 返回对象挂 `resolveAction`)
- [x] 1.3 `src/core/sdk/sessionLifecycle.ts`(或既有 switch/reset 收口点):清空 notices 队列

## 2. 类型与公共面

- [x] 2.1 `types/index.d.ts` + `types/headless.d.ts`:`resolveAction(name: string, outcome: 'applied' | 'discarded', detail?: string): boolean` + `SdkEvent` union 加 `action_resolved`;JSDoc 写明门禁/覆盖/幂等/一次性注入/不中断在途轮

## 3. 测试(新增功能同步补测试约定)

- [x] 3.1 selftest 新模块(sec-NN):resolve 三态(true/false×2)/ 同名覆盖后注入最终局 / 幂等 / 封顶与去重 / 段文案断言(以此为准 + 勿重复提议)/ augmentPrompt 多调不消费 + afterAgent 恰一次
- [x] 3.2 e2e `tests/e2e/action-semantics.mjs` 扩展:端到端链(deferred 动作调用 → resolveAction('applied', detail) → 下一轮请求 messages 含裁决段 → 再下一轮不含 = 一次性)/ 未标记动作 resolve 返 false 且无段 / switchSession 后段不出现 / `action_resolved` 事件收到
- [x] 3.3 计数同步:CHANGELOG [Unreleased] 箭头格式(3861→3879 / 1311→1320);CLAUDE.md/README 计数面随发布时三处同步(树内保持对账门禁绿,4.26.2 同例)+ CLAUDE.md 模块数 133→134

## 4. 文档与簿记

- [x] 4.1 usage-guide zh/en:`actions` 段补「deferredWrite 的裁决回传」小节(resolveAction 语义/一次性/不中断在途轮/learning 式消费示例);README zh/en 特性清单各一句
- [x] 4.2 CLAUDE.md actions 段补 resolveAction 一句;CHANGELOG minor 条目(注明与 proposalNotice 的家族关系);`openspec validate 2026-10-16-action-resolve-outcome --strict`
- [x] 4.3 发布门禁序列 + 临时安装实调(随 4.27.0 发布执行:门禁全绿;node 实调三态 PASS —— 未标记名拒/名字键覆盖+幂等/action_resolved 事件;CDN es2022 含 resolveAction)

## 4b. 消费方备忘(不在本 change 内,登记用)

- learning:ai-suggest 全决后聚合报 / profile-panel onSave → applied(detail 带手改)/ drop → discarded / 直接关面板不报;均在 SDK 发版后另行接线(obsidian 仓,用户缓存流)。
