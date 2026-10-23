# Design: deferredWrite 动作结局回传(resolveAction)

## 职责边界

- 动 `src/core/sdk/actions.ts`(或新增 `actionOutcome.ts` 小模块,见决策 5)、`src/core/sdk/createChatSdk.ts`(装配 + 生命周期)、`src/core/sdk/sessionLifecycle.ts`(switch/reset 清队列)、`types/index.d.ts` + `types/headless.d.ts`(公共 API 双侧)、README zh/en、usage-guide zh/en、CLAUDE.md actions 段、CHANGELOG(minor)。
- **零改动**:`ActionDef` 形状、`deferredWrite` 既有语义(零工具门禁注记)、content-proposals 全链(`resolveProposal`/`proposalNotice` 原样)、`ChatSdkOptions` 零新配置项。

## 关键决策

### 1. 名字键 + 同名覆盖(不做调用 id 键)

proposals 用提案 id 键(多提案并行是常态);actions 的现知消费形态全是「单挂起」—— 面板一次一草稿,新 `show` 整体替换旧的。名字键 + 同名覆盖即足,且 run 回执不混入 callId(那会污染模型可见面)。若未来出现「同动作多笔并行挂起」的真实宿主,再升 id 键(届时 resolveAction 加可选参,非 breaking)。

### 2. 严格限定 deferredWrite(门禁复用装配面既有集合)

`createChatSdk` 装配期已收集 `deferredWriteActionNames`(4.20 action-host-semantics 为零工具门禁建的);resolveAction 的合法名集合直接复用它。理由:①「待确认」口径(门禁事实清单)与「已确认」口径(结局段)必须罩同一批动作,否则模型会看到两处自相矛盾;②宿主 typo(未知名)与概念误用(报非 deferred 动作)都拦在门口,返 `false` + warn。

### 3. 并立 actionNotice,不泛化 proposalNotice

两通道同构不同体:proposalNotice 的行文是提案特化(「提案『summary』已被用户应用」)、按提案 id 键、有 pending 队列语义;actionNotice 按名字键、无 pending 概念(挂起状态在宿主面板里,SDK 不追踪)。强行统一要动 4.22 已验证面,回归风险大于收敛收益。CHANGELOG 注明家族关系;第三个消费者出现再评估。

### 4. 消费在 afterAgent,不在 augmentPrompt(4.18 S1)

augmentPrompt 同一轮会被多次调用(toLC/replaceSystem/收口综合/inspect),只有随请求那次生效 —— 在 augmentPrompt 里消费队列会被丢弃调用吞掉。proposalNotice 的既有写法(augmentPrompt 只读 + afterAgent 清空)是正确模板,原样平移。这也是本功能必须是 SDK 原语的核心理由:宿主自 roll 最容易踩死的就是这个坑。

### 5. 状态放哪:actionOutcome 小模块(纯函数 + 闭包态)

镜像 `proposals.ts` 的形态:`src/core/sdk/actionOutcome.ts` 导出 `createActionOutcomeChannel({ deferredNames, emit, log })` 返回 `{ resolve, notices, snapshot?, clear }`;createChatSdk 装配(有任一 deferredWrite 动作才建)并把 `resolve` 挂上 sdk 返回对象、把 `notices` 喂给 actionNotice 中间件。不走 actions.ts(那是无状态转换器,加闭包态会把纯函数层弄脏)。

### 6. 段文案定死(宿主只给 detail)

段头:「【宿主动作裁决结果】(以此为准;这些动作的效果以此处为准,不要凭调用时的回执猜测)」。逐行:「· 动作 <name> 的<草稿/提案>已被用户<采纳(已生效)/放弃(未生效)><detail 冒号随行> —— 已生效的可作事实引用;被放弃的不要当作已完成;不要重复提议已生效的内容。」封顶 5 条丢最旧、去重(与 proposals 同口径)。SDK 定死 = 措辞是防线(4.26.1 教训:回执措辞直接决定模型行为),开配置面会稀释它。

## 范围控制

- 中间件装载条件:装配期存在任一 `deferredWrite` 动作即装 actionNotice(无配置项);零 deferredWrite 动作的集成 = 中间件不装、`resolveAction` 仍挂(sdk 方法面稳定)但对一切名字返 false + warn。
- headless 同面:d.ts 双侧同步;事件/段与 UI 无关。
- 测试矩阵:selftest(新模块 sec:resolve 语义三态/覆盖/幂等/封顶/文案)+ e2e(action-semantics 扩展:端到端「deferred 调用 → 谎报收口被门禁拦 → resolveAction → 下一轮段注入 + 一次性」+ switchSession 清队列)。
