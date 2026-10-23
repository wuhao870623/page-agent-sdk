# Proposal: deferredWrite 动作结局回传(resolveAction 宿主裁决闭环)

> **状态**:✅ 已实施(2026-10-16,随 4.27.0 发布;9/9 任务勾,develop bfb2ae8/94b3f28、master 0edc906;同日消费方接线 —— learning 画像/技能面板 onSave/onDiscard → resolveAction,含 deferredWrite 标记补齐;残项 = propose_annotations 采纳结局回传需 defineTool 侧 deferredWrite 语义,真实困扰出现再立项;2026-10-16 归档)。

## Why

`deferredWrite` 标记(4.20,action-host-semantics)只做了「防谎报」半边:零工具门禁的事实清单对提案类调用注记「待用户确认后才生效」,但**用户裁决之后模型永远不知道结果** —— 采纳了还是放弃了,下一轮模型只能凭回执里那句「草稿在面板里等你确认」的旧记忆作答。消费方实据:learning 门户三处流踩着这个已知限制(propose_annotations 建议面板的逐条采纳、兴趣画像/助手技能的草稿-保存),README 明记「面板采纳结果没有回传通道给模型,防线只剩回执措辞与提示词纪律」。content-proposals 通道已有完整闭环(`resolveProposal` → `proposal_resolved` 事件 + 下轮一次性结局段注入),宿主 action 缺对称机制 —— 该模式已在 SDK 内验证过一次,现在是把它开给 actions 面。

## What Changes

- **`sdk.resolveAction(name, outcome: 'applied' | 'discarded', detail?): boolean`**(与 `resolveProposal` 镜像对称的公共 API):
  - **严格限定 `deferredWrite: true` 的动作**(装配面已有 `deferredWriteActionNames` 集合,现成):未标记或未知名 → 返 `false` + warn(概念配对 —— 「待确认」口径只罩 deferredWrite,宽松会出现门禁清单说「已生效」而 notice 说「被拒」的自相矛盾);
  - **名字键、同名覆盖**:actions 消费场景是「单挂起」(面板一次一草稿,新 show 替换旧),同名字队列只留最新一笔 —— 旧草稿被新草稿取代时无需再报;
  - `detail` 自由文本(「3 条候选:采纳 2、忽略 1」「保存前有手改」),部分采纳表达为 `applied` + detail;幂等:已裁决再报返 `false`。
- **`actionNotice` 中间件**(并立 `proposalNotice`,**不泛化统一** —— 提案那套行文特化且已验证,搬动 = 无谓回归面):
  - 队列非空 → `augmentPrompt` 注「【宿主动作裁决结果】」段;**段头与行为契约文案 SDK 定死**(以此为准 / 已生效的可作事实引用 / 被放弃的不要当作已完成 / 不要重复提议已生效的内容),宿主只提供 `detail` —— 措辞是防线的一部分(4.26.1 同源教训);
  - `afterAgent` 清空 = **一次性注入**(消费在 afterAgent 不在 augmentPrompt —— 同轮多次被调的 augmentPrompt 只读队列,4.18 S1 幂等契约的正确写法,这是它必须是 SDK 原语而非宿主变量的全部理由);
  - 去重 + 封顶 5 条(与 proposals 同口径)。
- **可观测性**:`action_resolved` 外发事件(name/outcome/detail)+ debugLogs stage `action_resolved`(与 4.26.2 的 `action_failed` 同族对称)。
- **生命周期**:`switchSession`/`resetSession` 清队列(会话级,同 approval grants);裁决在在途轮中途到达 → 自然落下一轮(**不中断在途轮**,文档明示);用户裁决后不再说话 → 队列随会话消亡(与 proposals 同语义)。
- **types 双侧同步**(`types/index.d.ts` + `types/headless.d.ts`)。

## Capabilities

### New Capabilities

- `action-resolve-outcome`:deferredWrite 动作的宿主裁决回传 —— resolveAction 语义(严格门禁/名字键覆盖/幂等)、结局段一次性注入与文案契约、可观测性与会话生命周期。

### Modified Capabilities

(无 —— `deferredWrite` 标记自身的语义不变;content-proposals 的 resolveProposal 零改动。)

## Scope

### In Scope

- SDK 公共 API `resolveAction` + `actionNotice` 中间件 + `action_resolved` 事件 + debugLogs 留痕 + types 双侧。
- 定级 **minor**(公共面纯加法;`ChatSdkOptions` 零新配置项 —— 中间件随任一 deferredWrite 动作存在而装配)。

### Non-goals

- **不泛化统一 proposalNotice**:两通道并立同构,第三个消费者出现前不收敛(CHANGELOG 注明家族关系)。
- **不做调用 id 键**:run 回执不混入 callId(污染模型可见面);名字键满足现知全部消费形态。
- **不做 inspect 反射面**:事件 + debugLogs 已够可观测;真有宿主要求再加(v1 最小面)。
- learning 门户的接线(建议面板/画像/技能面板调 resolveAction)是消费方工作,不在本 SDK change 内。
- 不罩非 deferredWrite 动作(如 save_draft 的「事后告知失败」形态 —— 那是另一个语义,出现真实需求再议)。
