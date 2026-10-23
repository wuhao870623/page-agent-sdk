# approval-resolution-events Specification

## Purpose

approval 确认(工具调用前人工确认)与 RHC(`request_human_confirmation` 方案征询)的**裁决收口**目前只进 debugLogs,宿主 onEvent/hook 观察不到「用户点了允许/拒绝/授权」。本能力把收口时刻外发为只读事件 `approval_resolved`,供宿主 UI 联动、审计上报与埋点。挂起请求事件 `approval_request` 携带 resolve 回调,**维持不外发现有语义**(防集成方误调 resolve 双重收口)。

## ADDED Requirements

### Requirement: 裁决收口统一外发只读事件

系统 SHALL 在每次确认收口(approval 工具确认与 `request_human_confirmation` 两个通道)外发 `approval_resolved` 事件,载荷 SHALL 为只读数据:`{ type: 'approval_resolved', toolName: string, approved: boolean, granted?: boolean, choice?: string, via: 'user' | 'timeout' | 'abort' }`,且 SHALL 不含 `resolve` / `hold` 等任何可变更挂起态的引用。`approved=false` SHALL 覆盖用户拒绝、超时自动拒与 abort 自动拒三种形态并以 `via` 区分;`granted=true` SHALL 仅在用户经「允许并不再询问(本会话)」入口授权时出现;`choice` SHALL 为字符串形裁决(RHC 选项文本)截断至 60 字符(与 debugLogs 留痕同口径),布尔形裁决不带该字段。

#### Scenario: 用户允许并授权(remember)

- **GIVEN** `approval: { tools: ['write'], remember: true }`,模型调用 `write` 触发确认条
- **WHEN** 用户点「允许并不再询问(本会话)」
- **THEN** onEvent 收到 `{ type: 'approval_resolved', toolName: 'write', approved: true, granted: true, via: 'user' }`,工具继续执行

#### Scenario: 用户拒绝

- **GIVEN** 确认条挂起中
- **WHEN** 用户点「拒绝」
- **THEN** 收到 `{ type: 'approval_resolved', toolName: ..., approved: false, via: 'user' }`,模型收到结构化拒绝回执

#### Scenario: 无响应超时自动拒

- **GIVEN** 无 UI 响应方路径(headless send),确认条挂起进入 30s 计时
- **WHEN** 计时到期自动拒
- **THEN** 收到 `{ type: 'approval_resolved', approved: false, via: 'timeout' }`

#### Scenario: abort 自动拒

- **GIVEN** 确认条挂起中
- **WHEN** 用户点停止生成(signal abort)
- **THEN** 收到 `{ type: 'approval_resolved', approved: false, via: 'abort' }`

#### Scenario: RHC 选项点选

- **GIVEN** 模型调 `request_human_confirmation`(带 options)挂起
- **WHEN** 用户点选方案 B
- **THEN** 收到 `{ type: 'approval_resolved', toolName: 'request_human_confirmation', approved: true, choice: '方案B…(截 60 字符)', via: 'user' }`

#### Scenario: approval_request 维持不外发

- **GIVEN** 任一确认条挂起
- **WHEN** 挂起事件产生
- **THEN** onEvent 不收到 `approval_request`(既有过滤不变;仅收口事件外发)

### Requirement: 与留痕/授权集的同源一致

`approval_resolved` 事件的判定与写损 SHALL 复用收口单点(finish):`granted` 语义 SHALL 与会话级授权集写入同源(事件 granted=true 当且仅当该次收口把工具名写入 grants),debugLogs 既有 `approval_resolved` 留痕 SHALL 继续产生(事件与留痕并行,不互相替代)。

#### Scenario: 授权集与事件同源

- **GIVEN** remember 开启且 `write` 尚未授权
- **WHEN** 用户经授权入口允许
- **THEN** `inspect().approvals.grantedTools` 出现 `write` 与事件 `granted: true` 同时成立;随后同会话再次调用 `write` 免确认直通且**不产生**新的 `approval_resolved` 事件(直通留痕 `approval_auto_allowed` 照旧)
