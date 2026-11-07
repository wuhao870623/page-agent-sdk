# Proposal

## Why

四项已评估的边际优化集中立项(2026-10-23 用户确认「规划你建议的可做的任务」),共同主题 = **外部内容信任分级 + 裁决/注入可观测**:

1. **approval 裁决对外不可见**:`approval_resolved` 外发事件在 deferred.md 2026-10-14 段登记,重启触发条件「集成方需要在 UI/埋点里联动用户点了允许/授权」**已经到达** —— learning 宿主的画像/技能面板与批注确认都需要审计联动,现状只能解析 debugLogs。
2. **RAG 检索内容零围栏是隐式假设**:fetch_document 对公网内容打 UNTRUSTED 围栏,RAG 检索结果(`ragSubagent.ts` search/load 回执)裸拼返回 —— 「源是集成方自控」的信任假设没有任何声明面,接公网爬取语料时该假设静默破裂。
3. **注入尝试零遥测**:围栏是提示级软防线,内容里真出现注入话术时无任何数据留痕(防御纵深的最外层不可观测)。
4. **两套裁决段中间件同构复制**:`actionOutcome.ts:6` 自认「与 proposalNotice 并立同构不统一」;且本次勘察发现 **`actionNotice` 不在 `PIN_SEGMENT_NAMES`**(`createAgent.ts:541` 含 `proposalNotice` 不含 `actionNotice`)—— 系统段超 25% 预算裁剪时,动作裁决段可被 drop 而提案裁决段幸免,4.27 的裁决回传在预算压力下不对称失效。

## What Changes

- **新增外发事件 `approval_resolved`**(只读载荷,不含 resolve/hold 引用,防集成方双重收口):approval 工具确认与 `request_human_confirmation`(RHC)两个收口点统一覆盖;载荷含 `toolName / approved / granted? / choice? / via('user'|'timeout'|'abort')`。`approval_request` 仍不外发(既有语义零变化)。
- **`createRagSubagent` 新增 `contentTrust?: 'trusted' | 'untrusted'`**(默认 `trusted` 现行为零变化):`untrusted` 时 search/load 回执逐 hit 套 fetch_document 同款 UNTRUSTED 围栏;围栏文案抽共享纯函数(输出逐字不变)。
- **注入遥测(只留痕不阻断)**:轻量正则扫描(精度优先宁漏勿误,≤10 中英模式)覆盖 fetch_document 与 RAG search/load 回执(受控源也扫 —— 被投毒的受控源同样是信号);命中 → debugLogs `stage:'suspected_injection'` + `inspect().injectionSuspicions` 会话累计;不改回执内容、不阻断、不加开关(纯可观测,先例:挂起双留痕)。
- **outcomeNotice 中间件工厂收敛**:proposalNotice / actionNotice 两处内联中间件委托共享工厂(`createOutcomeNoticeMiddleware`);`PIN_SEGMENT_NAMES` 补 `actionNotice`(修预算裁剪不对称,行为对齐 proposalNotice)。
- 定级 **minor**(纯加法:新事件成员 + 新 opt-in 配置 + inspect 字段;无移除无收紧)。

## Capabilities

### New Capabilities

- `approval-resolution-events`: approval/RHC 裁决收口的外发只读事件(载荷形态、via 三态、approval_request 不外发维持)
- `content-trust-fencing`: RAG 检索通道的信任分级声明与 UNTRUSTED 围栏(与 fetch_document 共享实现)
- `injection-telemetry`: 外部内容通道的注入话术扫描与留痕(扫描面、只留痕语义、零开销边界)

### Modified Capabilities

(无 —— `openspec/specs/` 现仅 `page-agent-core.md` 单文件形态,本变更全部为新增能力面;PIN 修复与中间件收敛是实现级修正,不构成 spec 级行为变更,落 tasks + CHANGELOG。)

## Impact

- **代码**:`harness/approval.ts` + `harness/humanConfirm.ts`(finish 收口点 emit + via 参数)、`sdk/events.ts`(类型面)、`sdk/ragSubagent.ts`(contentTrust + 扫描接线)、`tools/fetchDoc.ts`(围栏抽离改消费)、新增 `tools/untrustedContent.ts`(围栏 + 扫描纯函数)、`sdk/createChatSdk.ts`(telemetry 装配 + outcomeNotice 工厂替换两处内联)、`harness/createAgent.ts`(PIN_SEGMENT_NAMES + actionNotice)、`sdk/actionOutcome.ts`/`sdk/proposals.ts`(中间件委托工厂)
- **公共面**(过「公共面变更纪律」自查):`SdkEvent` union 新成员 `approval_resolved`(4)、`inspect()` 新字段 `injectionSuspicions`(5)、`CreateRagSubagentOptions` 新可选 `contentTrust`(3 类)= 全加法 minor
- **类型**:`types/index.d.ts` + `types/headless.d.ts` 双侧同步
- **测试**:selftest 新模块(围栏逐字一致/扫描器命中与反例/outcomeNotice 工厂/PIN 含 actionNotice)+ e2e(events 四形态 approval_resolved、capability-packs contentTrust、inspect 反射)+ browser 既有 approval spec 补事件断言
- **文档**:usage-guide zh/en、CLAUDE.md(approval 段/RAG 段/测试计数)、CHANGELOG 4.28.0、deferred.md 2026-10-14 段收口
- **不做**:per-hit 信任标记(源级属性,集成方可拆双子 agent 表达)、注入自动阻断/分类模型(与「裁决归 LLM/人」哲学冲突)、`approval_request` 外发(维持防双重收口)、DOM 读/数据槽读扫描(误报高,明示不在面)
