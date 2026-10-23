# Tasks

> 约定:每任务完成即勾选;实施注记(与设计的偏差/坑)直接写在任务行下。发布门禁在 §4,全绿才可「发布」。

## 1 · 实施

- [x] 1.1 `src/core/tools/untrustedContent.ts` 新模块:`UNTRUSTED_WARNING` 常量 + `wrapUntrustedContent(text, label?)`(警示行 + BEGIN/END 分隔)+ `scanInjectionHints(text)`(≤10 中英模式,返回 `{pattern, snippet}[] | null`;纯函数零依赖)
  - 注:实现为 7 组模式(≤10 上限内);另含 `reportSuspicion`(订阅上报,回调异常吞掉)+ `wireContentTelemetry`(标记发现接线,幂等)两辅助 —— 单例/多实例安全的订阅制挂点。
- [x] 1.2 `fetchDoc.ts` 改消费 `wrapUntrustedContent`(删内联文案,输出逐字节不变);同时接入 `onSuspicion` 扫描(工厂经 `createFetchDocTool` 既有装配链拿到回调,deps 注入,缺省 no-op)
  - 注:任务文本写的 `createFetchDocTool` 工厂不存在 —— `fetchDocumentTool` 是模块单例;实际机制 = 遥测订阅集以 `__pgContentTelemetry` 标记挂工具对象(`__pgWatchdog` 先例,标记随引用走),createChatSdk 装配层 `wireContentTelemetry` 发现接线。输出逐字节一致由 sec-140① 锁定。
- [x] 1.3 `approval.ts`:`finish` 加 `via` 第二参(abort → 'abort',timeout timer → 'timeout',用户默认 'user');收口处 `ctx.emit({ type:'approval_resolved', toolName, approved: !ok ? false : true, ...(granted ? { granted: true } : {}), ...(choice 形 ? { choice } : {}), via })`;grants 直通分支不 emit
- [x] 1.4 `humanConfirm.ts`:同款 via 参数 + `approval_resolved` emit(`toolName='request_human_confirmation'`,choice 承接字符串裁决截 60)
- [x] 1.5 `ragSubagent.ts`:`CreateRagSubagentOptions` 加 `contentTrust?: 'trusted'|'untrusted'` + `onSuspicion?` 透传;`buildSearchTool`/`buildLoadTool` 组装回执时:untrusted 逐 hit `wrapUntrustedContent`(来源行在外)+ 无条件 `scanInjectionHints` → `onSuspicion`
  - 注:两工具壳共享 `renderRagHits`(围栏 + 扫描单点);label 用「检索内容」泛化警示主语。
- [x] 1.6 `src/core/sdk/outcomeNotice.ts`:`createOutcomeNoticeMiddleware({name, header, getNotices, clear})` 工厂(augmentPrompt 非空注入段头+行;afterAgent clear;4.18 S1 幂等写法平移);`createChatSdk.ts` 两处内联中间件改委托,装配条件与装载位次不变
- [x] 1.7 `createAgent.ts` `PIN_SEGMENT_NAMES` 补 `'actionNotice'`(与 proposalNotice 相邻);同步该处注释
  - 注:常量提升到模块级并导出供测试断言(不经 src/core/index.ts,非公共面)。
- [x] 1.8 `createChatSdk.ts` 注入遥测装配:pushLog(`stage:'suspected_injection'`,含 tool/pattern/snippet)+ 会话计数 `injectionSuspicions`;fetchDoc 与 ragSubagent 装配点接线
  - 注:动态 `setSubagents`/`addSubagent` 路径同款接线(任务未列,装配期一致性补齐)。
- [x] 1.9 `inspect()` 投射 `injectionSuspicions: number`(AgentInfo 平铺,先例 staleReadsInvalidated)
  - 注:src 侧 AgentInfo(src/core/types/index.ts)同步补字段,types-alignment 门禁要求双侧。
- [x] 1.10 `types/index.d.ts` + `types/headless.d.ts` 双侧:`ApprovalResolvedEvent`(含 via 三态)/ `CreateRagSubagentOptions.contentTrust` / `AgentInfo.injectionSuspicions`;`src/core/types/index.ts` SdkEvent union 同步
  - 注:双入口补类型导出 `InjectionHint`(onSuspicion 载荷;纯类型加法)。

## 2 · 测试(与实施同 commit,强制)

- [x] 2.1 selftest 新模块 sec-NN(接 134 模块序列):①围栏单源一致(同输入 fetchDocument 组装 vs wrapUntrustedContent 全等)②scanInjectionHints 命中表(每模式 ≥1 正例)③**反例基线**(含 instructions 的安装文档/含「以上」的中文说明/正常长文,零命中)④outcomeNotice 工厂(注入/一次性/空队列不注)⑤PIN_SEGMENT_NAMES 含 actionNotice(经超预算构造或导出断言)⑥wrapUntrustedContent label 泛化
  - 注:落地 sec-140(模块数 134→135;含 approval_resolved 中间件级四形态 + RHC choice/timeout 形态);①用「4.27 硬编码文案逐字节重建」做零变化锁;实施中修两处用例:中文模式正则补可选「的」、截断样例加长到 >60 字符。
- [x] 2.2 e2e `events.mjs` 补:approval_resolved 四形态(user-approve+granted/user-deny/timeout/abort)+ approval_request 仍不外发 + RHC choice 形态
  - 注:拆 4 块(授权/拒绝/直通/不外发一块 + timeout / abort / RHC 各一块)—— abort 轮会中断后续模型调用,与 RHC 同队列会错位 stub 响应。
- [x] 2.3 e2e `capability-packs.mjs` 补:contentTrust 缺省回执无围栏;untrusted 逐 hit 围栏(检索 stub 驱动)
- [x] 2.4 e2e `inspect.mjs` 或 `host-integration.mjs` 补:`injectionSuspicions` 计数(fetch stub 命中 → 1;正常 → 0)+ debugLogs stage 存在性
- [x] 2.5 browser:huma-confirm / approval 相关既有 spec 补 `approval_resolved` 事件断言(mock 流量已可驱动确认条收口)
  - 注:demo App.vue 挂 `window.__approvalResolved` DEV 钩子;允许/拒绝两用例各断言 2 事件(RHC choice 形 + write 允许/拒绝形)。
- [x] 2.6 回归红线:全量 selftest/e2e 无注入话术场景零新增留痕、回执不变(D7 验收线)
  - 注:selftest 3927/0、e2e 1339/0、browser 191+1skip/0(5199 临时端口配置跑,5173 被 learning dev server 占用)。

## 3 · 文档(同步勿漏单边)

- [x] 3.1 `doc/usage-guide.md` + `.en.md`:approval 段补 approval_resolved 事件(含 via 表);RAG 段补 contentTrust;安全/排障段补注入遥测(injectionSuspicions + suspected_injection)
- [x] 3.2 `README.md` + `README.zh-CN.md`:事件清单/能力清单各补一行
  - 注:落在 approval 配置行 + 能力包行(各一短句);徽章 selftest 3879→3927。
- [x] 3.3 `CLAUDE.md`:approval 段(approval_resolved 外发)、ragSubagent 段(contentTrust)、测试计数三处同步
  - 注:计数 3879/1320/188 → 3927/1339/191(browser 补齐 actions-demo 漏更的 +3);模块数 134→135;顺修「openspec CLI 不可用」过时句。
- [x] 3.4 `CHANGELOG.md` [Unreleased]:Added(approval_resolved 事件 / contentTrust / 注入遥测 / actionNotice PIN 修复)/ 计数箭头
- [x] 3.5 `openspec/deferred.md`:2026-10-14 段 approval_resolved 条目标 ✅ 随本变更收口

## 4 · 发布门禁(用户说「发布」才执行)

- [ ] 4.1 `npm run build && npm test && npm run test:e2e && npm run test:browser`
- [ ] 4.2 `npm run test:exports && npm run test:types && npm run test:types-alignment && npm run test:types-novue && npm run test:size`
- [ ] 4.3 `node scripts/check-test-counts.mjs`(三计数 + README 徽章对账)→ `npm pack --dry-run`
- [ ] 4.4 bump minor(4.28.0)→ develop commit → `./scripts/publish.sh` → `npm publish` → 验证(npm view / 临时安装实调 approval_resolved 事件与 contentTrust / CDN)
