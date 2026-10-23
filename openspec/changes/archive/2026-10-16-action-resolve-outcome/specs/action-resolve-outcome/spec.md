# action-resolve-outcome Specification

## Purpose

deferredWrite 宿主动作的裁决闭环:用户在工具调用之外(面板/确认条)采纳或放弃「延迟生效」的动作结果后,宿主经 `sdk.resolveAction` 把结局回传,SDK 在下一轮以一次性系统段告知模型 —— 补齐 4.20 deferredWrite「待确认」口径的另一半(「已确认,结果是什么」)。

## ADDED Requirements

### Requirement: resolveAction 的严格门禁与名字键语义

系统 SHALL 提供 `sdk.resolveAction(name, outcome, detail?)`,SHALL 只接受装配时标记 `deferredWrite: true` 的动作名(未标记或未知名返回 `false` 并 warn,不注入任何段),SHALL 以动作名为键且同名字只保留最新一笔裁决(后报覆盖先报 —— 单挂起语义:旧草稿被新草稿取代时无需再报),且 SHALL 在同名字已裁决后再次上报时返回 `false`(幂等)。outcome SHALL 为 `'applied' | 'discarded'` 二值,部分采纳 SHALL 以 `applied` + detail 表达,detail 为自由文本随行透传。

#### Scenario: 采纳后下一轮注入

- **GIVEN** 已注册 `deferredWrite: true` 的动作 `update_interest_profile`,且模型上一轮调用过它
- **WHEN** 用户在面板点「保存」,宿主调 `resolveAction('update_interest_profile', 'applied', '保存前有手改')`
- **THEN** 返回 `true`;下一轮模型请求的 system prompt 含「宿主动作裁决结果」段,行文含动作名、已生效语义与 detail
- **AND** 模型正在回答的在途轮不被中断(段落在下一轮才注入)

#### Scenario: 未标记 / 未知名拒绝

- **GIVEN** 动作 `save_draft` 未标记 `deferredWrite`
- **WHEN** 宿主误调 `resolveAction('save_draft', 'applied')`
- **THEN** 返回 `false` 并 warn(不注入段);对完全未知名同样返 `false`

#### Scenario: 同名覆盖与幂等

- **GIVEN** `resolveAction('update_assistant_skills', 'discarded')` 已入队
- **WHEN** 用户重新起草并保存,宿主再调 `resolveAction('update_assistant_skills', 'applied')`
- **THEN** 队列中该名字仅剩 `applied` 一笔(下一轮注入的是最终结局);对同名字重复上报相同结局返回 `false`

### Requirement: 结局段一次性注入与定死文案

系统 SHALL 经独立中间件(actionNotice,与 proposalNotice 并立)在队列非空时于 `augmentPrompt` 注入「宿主动作裁决结果」段,SHALL 在整轮结束(`afterAgent`)清空队列使注入严格一次性(同一裁决不跨轮重放),SHALL 由 SDK 定死段头与模型行为契约文案(以此为准 / 已生效的可作事实引用 / 被放弃的不要当作已完成 / 不要重复提议已生效的内容 —— 宿主仅能提供 detail,不能改写段头),且 SHALL 对队列去重并封顶 5 条(超出丢最旧)。

#### Scenario: 一次性注入

- **GIVEN** 队列中有一笔已注入本轮的裁决
- **WHEN** 本轮结束,用户再发下一条消息
- **THEN** 下一轮 system prompt 不再含该裁决段

#### Scenario: augmentPrompt 幂等

- **GIVEN** 队列非空,本轮 augmentPrompt 因收口综合/inspect 等被调多次
- **WHEN** 段被重复渲染
- **THEN** 队列内容不受影响(消费只发生在 afterAgent,整轮恰一次)

### Requirement: 可观测性与会话生命周期

系统 SHALL 在 resolveAction 成功时外发 `action_resolved` 事件(name/outcome/detail)并留痕 debugLogs(stage `action_resolved`,与 `action_failed` 同族),SHALL 在 `switchSession`/`resetSession` 清空队列(裁决是会话级事实),且 SHALL 使队列中未送达的裁决随会话消亡而不报错(用户裁决后不再发消息 = 无下一轮 = 不注入,合法态)。

#### Scenario: 事件与留痕

- **WHEN** 宿主成功调 resolveAction
- **THEN** `onEvent` 收到 `action_resolved`(含 name/outcome/detail),debugLogs 新增一条 stage `action_resolved`

#### Scenario: 会话切换清队列

- **GIVEN** 队列中有一笔未注入的裁决
- **WHEN** 宿主调 `switchSession`(或 `resetSession`)
- **THEN** 队列清空,新会话首轮 system prompt 不含该裁决
