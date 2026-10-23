// 事件:hook 返回取消函数 / onEvent + hook 联动 / 多监听器 + off 重复调用安全
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk, z } from './_helpers.mjs'
import { stubModel } from './_stub-model.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:events] sdk.hook 返回取消函数')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-hook', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' }, description: '标题' },
    })
    await sdk.mount()
    const off = sdk.hook(() => {})
    assert(typeof off === 'function', 'sdk.hook 返回取消函数(function)')
    off()
    sdk.unmount()
  }

  console.log('[e2e:events] onEvent + sdk.hook 联动(构造时 onEvent 与运行时 hook 均注册)')
  {
    globalThis.window.app = {}
    let onEventCount = 0, hookCount = 0
    const sdk = createChatSdk({
      ui: false, id: 'e2e-events', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' }, description: '标题' },
      onEvent: () => { onEventCount++ },
    })
    await sdk.mount()
    const off = sdk.hook(() => { hookCount++ })
    assert(typeof off === 'function' && onEventCount === 0 && hookCount === 0, 'onEvent + hook 均挂载,未触发前计数为 0')
    off()
    sdk.unmount()
  }

  console.log('[e2e:events] hook 多监听器 + off 重复调用安全')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-hook-multi', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    let c1 = 0, c2 = 0
    const off1 = sdk.hook(() => { c1++ })
    const off2 = sdk.hook(() => { c2++ })
    assert(typeof off1 === 'function' && typeof off2 === 'function', '注册两个 hook 均返回取消函数')
    off1()
    off1()
    off2()
    assert(c1 === 0 && c2 === 0, '未触发事件前两监听器计数均为 0')
    sdk.unmount()
  }

  console.log('[e2e:events] sdk.usage 累计 token 用量(初始 0,字段齐全)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-usage', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' } },
    })
    await sdk.mount()
    const u = sdk.usage
    assert(u && typeof u === 'object', 'sdk.usage 存在(对象)')
    assert(u.prompt_tokens === 0 && u.completion_tokens === 0 && u.total_tokens === 0, '初始用量全为 0(无 LLM 调用)')
    sdk.unmount()
  }

  console.log('[e2e:events] ✓ usage 事件与 sdk.usage 反映 reasoning_tokens(reasoning-tokens-observability;completion 子集单独累计)')
  {
    const llm = stubModel({ text: 'ok', usage: { prompt_tokens: 10, completion_tokens: 100, total_tokens: 110, completion_tokens_details: { reasoning_tokens: 60 } } })
    const events = []
    const sdk = createChatSdk({
      ui: false, id: 'e2e-usage-reasoning', storage: 'memory', llm, capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' } },
      onEvent: (e) => { if (e.type === 'usage') events.push(e) },
    })
    await sdk.mount()
    await sdk.send('x')
    const ue = events[events.length - 1]
    assert(ue && ue.usage.reasoning_tokens === 60, '✓ usage 事件 round usage 带 reasoning_tokens(60,原始 completion_tokens_details 归一)')
    assert(ue && ue.cumulative.reasoning_tokens === 60 && ue.cumulative.completion_tokens === 100, '✓ usage 事件 cumulative 透传 reasoning(60)且 completion 不受影响(子集不加数)')
    assert(sdk.usage.reasoning_tokens === 60, '✓ sdk.usage.reasoning_tokens 累计(60)')
    sdk.unmount()
  }

  console.log('[e2e:events] ✓ 无 reasoning 细分 → 字段省略不占位(Anthropic 依赖栈现状;旧三字段逐位不变)')
  {
    const llm = stubModel({ text: 'ok', usage: { prompt_tokens: 10, completion_tokens: 40, total_tokens: 50 } })
    const events = []
    const sdk = createChatSdk({
      ui: false, id: 'e2e-usage-noreason', storage: 'memory', llm, capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' } },
      onEvent: (e) => { if (e.type === 'usage') events.push(e) },
    })
    await sdk.mount()
    await sdk.send('x')
    const ue = events[events.length - 1]
    assert(ue && ue.usage.reasoning_tokens === undefined && ue.cumulative.reasoning_tokens === undefined, '✓ 无 reasoning 细分 → usage/cumulative 均不携带(不置 0 不占位)')
    assert(ue && ue.usage.prompt_tokens === 10 && ue.usage.completion_tokens === 40 && ue.usage.total_tokens === 50, '✓ 旧三字段行为逐位不变')
    sdk.unmount()
  }

  console.log('[e2e:events] session_restored 事件类型可订阅(switchSession 切回已存会话不报错;真实快照触发需 LLM 造数据,e2e 用 FAKE_LLM 仅验证类型系统)')
  {
    let restored = null
    const sdk = createChatSdk({
      ui: false, id: 'e2e-restore', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' } },
      onEvent: (e) => { if (e.type === 'session_restored') restored = e },
    })
    await sdk.mount()
    const sid2 = await sdk.switchSession()  // 新建空会话(无快照,不发 session_restored)
    assert(typeof sid2 === 'string', 'switchSession 返回新会话 id')
    // 切回原会话(无快照不发事件,验证不报错 + 类型可订阅)
    await sdk.switchSession('e2e-restore')
    // restored 可能为 null(无快照)或对象(有快照);两种均合法,仅验证不报错
    assert(restored === null || (typeof restored.sessionId === 'string' && typeof restored.rounds === 'number'), 'session_restored 事件类型正确(有快照时含 sessionId/rounds,无快照时不发)')
    sdk.unmount()
  }

  console.log('[e2e:events] P1-23 → 不传 options.onEvent 时 sdk.hook 也能收到流式事件(headless 常见路径;修复 emit 恒调用)')
  {
    const types = []
    const sdk = createChatSdk({
      ui: false, id: 'e2e-hook-stream', storage: false, llm: stubModel({ text: '流式回复' }), capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' } },
    })
    await sdk.mount()
    const off = sdk.hook((e) => { types.push(e.type) })
    // 直接调 stream(headless 路径,构造时不传 onEvent):bug 是 userOnEvent 缺失 → emit 不调用 → hook 收不到流式事件
    await sdk.stream([{ role: 'user', content: 'hi', timestamp: Date.now() }], () => {})
    off()
    assert(types.includes('done'), 'P1-23 → 不传 onEvent 时 hook 收到流式 done 事件(修复:emit 恒调用)')
    assert(types.some((t) => ['text', 'round_start'].includes(t)), 'P1-23 → hook 收到流式过程事件(text/round_start)')
    sdk.unmount()
  }

  console.log('[e2e:events] F1 → send() 路径全量事件外发(headless 自建 UI 经 sdk.hook 听全字段,原只 emit error)')
  {
    const types = []
    const llm = stubModel(
      { toolCalls: [{ name: 'read', args: { jsonPath: 'title' } }] },
      { text: '已读取' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-send-events', storage: false, llm, capabilities: MIN_CAPS, autoTitle: false,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' } },
    })
    await sdk.mount()
    const off = sdk.hook((e) => { types.push(e.type) })
    await sdk.send('读一下标题')
    off()
    // 过程事件:send 路径原只 emit error,现全量(headless send 用户可见工具调用/轮次/收口)
    assert(types.includes('tool_call') && types.includes('tool_result'), 'F1 → send() 经 hook 收到 tool_call/tool_result 事件')
    assert(types.includes('round_start') && types.includes('done'), 'F1 → send() 经 hook 收到 round_start/done 事件')
    assert(!types.includes('approval_request'), 'F1 → send() 路径 approval_request 仍不外发(无 UI 响应方,由 30s 自动拒收口)')
    sdk.unmount()
  }

  console.log('[e2e:events] ✓ approval_resolved 外发事件:授权/拒绝/直通不产事件 + approval_request 仍不外发(4.28)')
  {
    // 队列:① write 挂确认 → 授权形收口 {approved:true,remember:true} ② read 挂确认 → 用户拒绝
    // ③ write 再调(已授权直通执行;队列尾默认纯文本收口)
    const llm = stubModel(
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'title', value: 'x' } } }] },
      { text: '(轮1完成)' },
      { toolCalls: [{ name: 'read', args: { jsonPath: 'title' } }] },
      { text: '(轮2完成)' },
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'title', value: 'z' } } }] },
    )
    const resolved = []
    const sdk = createChatSdk({
      ui: false, id: 'e2e-approval-resolved', storage: 'memory', llm, autoTitle: false,
      data: { schema: z.object({ title: z.string() }), bind: { title: 'a' }, description: 'd' },
      approval: { tools: ['write', 'read'], remember: true },
      capabilities: { ...MIN_CAPS },
    })
    await sdk.mount()
    const hookTypes = []
    const off = sdk.hook((e) => { hookTypes.push(e.type); if (e.type === 'approval_resolved') resolved.push(e) })
    // 轮1:write 挂起 → 经 stream 通道拿到 approval_request,以「允许并不再询问」收口
    const s1 = sdk.stream([{ role: 'user', content: '改标题', timestamp: Date.now() }], (e) => {
      if (e.type === 'approval_request') e.resolve({ approved: true, remember: true })
    })
    await s1
    const a = resolved[resolved.length - 1]
    assert(a && a.toolName === 'write' && a.approved === true && a.granted === true && a.via === 'user' && !('choice' in a), `✓ 授权入口 → {approved:true, granted:true, via:'user'}(实得 ${JSON.stringify(a)})`)
    assert(JSON.stringify(sdk.inspect().approvals?.grantedTools) === JSON.stringify(['write']), '✓ granted 与授权集同源(inspect().approvals.grantedTools 同步出现 write)')
    // 轮2:read 挂起 → 用户拒绝(布尔 false)
    const s2 = sdk.stream([{ role: 'user', content: '读标题', timestamp: Date.now() }], (e) => {
      if (e.type === 'approval_request' && e.toolName === 'read') e.resolve(false)
    })
    await s2
    const d = resolved[resolved.length - 1]
    assert(d && d.toolName === 'read' && d.approved === false && d.via === 'user' && !('granted' in d) && !('choice' in d), `✓ 用户拒绝 → {approved:false, via:'user'}(实得 ${JSON.stringify(d)})`)
    // 轮3:已授权的 write 直通 → 不产新的 approval_resolved(approval_auto_allowed 留痕照旧)
    const s3 = sdk.stream([{ role: 'user', content: '再改标题', timestamp: Date.now() }], (e) => { void e })
    await s3
    assert(resolved.length === 2, `✓ 授权直通不产 approval_resolved(计数恒 2,实得 ${resolved.length})`)
    assert(sdk.debugLogs.value.some((l) => l.data?.stage === 'approval_auto_allowed' && l.data?.toolName === 'write'), '✓ 直通留痕 approval_auto_allowed')
    // approval_request 全程不外发(hook 通道只见 approval_resolved)
    assert(!hookTypes.includes('approval_request'), '✓ approval_request 维持不外发(仅收口事件外发)')
    off()
    sdk.unmount()
  }

  console.log('[e2e:events] ✓ approval_resolved 超时形态(4.28)')
  {
    const llm = stubModel(
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'title', value: 'x' } } }] },
      { text: '(超时后收口)' },
    )
    const resolved = []
    const sdk = createChatSdk({
      ui: false, id: 'e2e-approval-timeout', storage: 'memory', llm, autoTitle: false,
      data: { schema: z.object({ title: z.string() }), bind: { title: 'a' }, description: 'd' },
      approval: { tools: ['write'], timeoutMs: 60 },
      capabilities: { ...MIN_CAPS },
    })
    await sdk.mount()
    const off = sdk.hook((e) => { if (e.type === 'approval_resolved') resolved.push(e) })
    await sdk.stream([{ role: 'user', content: '改标题', timestamp: Date.now() }], () => {}) // 挂起无人应答(hold 不调)→ 60ms 自动拒
    assert(resolved[0] && resolved[0].toolName === 'write' && resolved[0].approved === false && resolved[0].via === 'timeout', `✓ 超时自动拒 → via:'timeout'(实得 ${JSON.stringify(resolved[0])})`)
    off()
    sdk.unmount()
  }

  console.log('[e2e:events] ✓ approval_resolved abort 形态(4.28)')
  {
    const llm = stubModel(
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'title', value: 'y' } } }] },
      { text: '(abort 后收口)' },
    )
    const resolved = []
    const sdk = createChatSdk({
      ui: false, id: 'e2e-approval-abort', storage: 'memory', llm, autoTitle: false,
      data: { schema: z.object({ title: z.string() }), bind: { title: 'a' }, description: 'd' },
      approval: { tools: ['write'] },
      capabilities: { ...MIN_CAPS },
    })
    await sdk.mount()
    const off = sdk.hook((e) => { if (e.type === 'approval_resolved') resolved.push(e) })
    const s = sdk.stream([{ role: 'user', content: '改', timestamp: Date.now() }], () => {}) // 挂起不 resolve
    await new Promise((r) => setTimeout(r, 100))
    await sdk.switchSession() // abortAllActive → signal 联动自动拒
    await s.catch(() => {})
    assert(resolved[0] && resolved[0].approved === false && resolved[0].via === 'abort', `✓ abort 联动 → via:'abort'(实得 ${JSON.stringify(resolved[0])})`)
    off()
    sdk.unmount()
  }

  console.log('[e2e:events] ✓ approval_resolved RHC choice 形态(4.28)')
  {
    const llm = stubModel(
      { toolCalls: [{ name: 'request_human_confirmation', args: { question: '改标题用哪个方案?', options: ['方案A:仅改标题', '方案B:改标题并调整间距'], recommendation: '方案A:仅改标题' } }] },
      { text: '(已按所选方案执行)' },
    )
    const resolved = []
    const sdk = createChatSdk({
      ui: false, id: 'e2e-approval-rhc', storage: 'memory', llm, autoTitle: false,
      data: { schema: z.object({ title: z.string() }), bind: { title: 'a' }, description: 'd' },
      capabilities: { ...MIN_CAPS },
    })
    await sdk.mount()
    const off = sdk.hook((e) => { if (e.type === 'approval_resolved') resolved.push(e) })
    await sdk.stream([{ role: 'user', content: '给我方案', timestamp: Date.now() }], (e) => {
      if (e.type === 'approval_request' && e.toolName === 'request_human_confirmation') e.resolve('方案B:改标题并调整间距')
    })
    const c = resolved.find((r) => r.toolName === 'request_human_confirmation')
    assert(c && c.approved === true && c.choice === '方案B:改标题并调整间距' && c.via === 'user' && !('granted' in c), `✓ RHC 点选方案 → choice 形外发(实得 ${JSON.stringify(c)})`)
    off()
    sdk.unmount()
  }

  console.log('[e2e:events] eval_script → data_change(node 无 Worker:transform 失败不发〔P2#8 口径〕;成功落地映射由 browser page-demo 覆盖)')
  {
    // node 无 Worker 沙箱:transform 脚本实际不落地(dataOps 返回 ERROR: 无法创建 Worker 沙箱)→ P2#8 口径下
    // 失败写不发 data_change(修前:失败写照发 —— 旧断言曾把该照发当「映射契约」断言,实为假绿);
    // query 只读不发不变。transform 成功落地的映射(transform → operation=edit → 宿主重渲染)由
    // browser page-demo.spec.ts「打乱 → data_change → 画布重渲染」用例覆盖(Worker 可用真跑)。
    const events = []
    const bind = { title: 't', items: [1, 2, 3] }
    const llm = stubModel(
      { toolCalls: [{ name: 'eval_script', args: { jsonPath: 'items', mode: 'query', script: 'return data.length;' } }] },
      { toolCalls: [{ name: 'eval_script', args: { jsonPath: 'items', mode: 'transform', script: 'return data.slice().reverse();' } }] },
      { text: '完成' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-eval-transform-event', storage: 'memory', llm, capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string(), items: z.array(z.number()) }), bind },
      onEvent: (e) => { if (e.type === 'data_change') events.push(e) },
    })
    await sdk.mount()
    await sdk.send('处理 items')
    assert(bind.items.join(',') === '1,2,3', '前置:node 无 Worker → transform 未落地(bind 保持原序)')
    assert(events.length === 0, `✓ P2#8 eval transform 在 node 失败(Worker 不可用)→ 零 data_change(query 只读本就不发;修前:失败写照发 1 次假事件)`)
    sdk.unmount()
  }

  console.log('[e2e:events] ✓ draft_commit 落地 → data_change(同漏发面;opt-in draftWrite 经 vfs 装配)')
  {
    const events = []
    const bind = { title: 't' }
    const llm = stubModel(
      { toolCalls: [{ name: 'draft_write', args: { draftId: 'd1', chunk: '{"title":"新标题"}', mode: 'start' } }] },
      { toolCalls: [{ name: 'draft_commit', args: { draftId: 'd1' } }] },
      { text: '完成' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-draft-commit-event', storage: 'memory', llm, capabilities: { ...MIN_CAPS, vfs: true, draftWrite: true },
      data: { schema: z.object({ title: z.string() }), bind },
      onEvent: (e) => { if (e.type === 'data_change') events.push(e) },
    })
    await sdk.mount()
    await sdk.send('分块写标题')
    assert(bind.title === '新标题', '✓ draft_commit 落地(bind.title 已更新)')
    assert(events.length === 1 && events[0].operation === 'edit', '✓ draft_commit → 恰发 1 次 data_change(operation=edit;修前 draft_write/commit 均不发)')
    sdk.unmount()
  }

  console.log('[e2e:events] ✓ setData 整体替换 → data_change(team-audit P2 修:与 importData 口径对齐,修前不发)')
  {
    const events = []
    const bind = { title: '旧' }
    const sdk = createChatSdk({
      ui: false, id: 'e2e-setdata-event', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string() }), bind },
      onEvent: (e) => { if (e.type === 'data_change') events.push(e) },
    })
    await sdk.mount()
    const newBind = { title: '新' }
    sdk.setData({ schema: z.object({ title: z.string() }), bind: newBind })
    assert(events.length === 1 && events[0].operation === 'set' && events[0].value === newBind,
      '✓ setData → 恰发 1 次 data_change(operation=set,value=新 bind;非 reactive 宿主重渲染依赖)')
    // importData 同口径对照(既有行为零回归)
    const r = sdk.importData({ title: '导入' })
    assert(r.ok === true && events.length === 2 && events[1].operation === 'set',
      '✓ importData 仍发 data_change(两 API 口径一致)')
    sdk.unmount()
  }

  console.log('[e2e:events] ✓ write patches 批量意图 → operation=edit;dryRun 探演不落地 → 不发(code-review 收口:修前 patches 误标 set / dryRun 空刷新)')
  {
    const events = []
    const bind = { title: 't', tags: ['a'] }
    const llm = stubModel(
      // dryRun 探演:不落地 → 不发 data_change
      { toolCalls: [{ name: 'write', args: { dryRun: true, patch: { op: 'append', jsonPath: 'tags', value: 'b' } } }] },
      // patches 批量意图(原子)→ operation=edit(修前误标 set)
      { toolCalls: [{ name: 'write', args: { patches: [{ op: 'append', jsonPath: 'tags', value: 'b' }, { op: 'set', jsonPath: 'title', value: '新标题' }] } }] },
      { text: '完成' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-write-op-infer', storage: 'memory', llm, capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string(), tags: z.array(z.string()) }), bind },
      onEvent: (e) => { if (e.type === 'data_change') events.push(e) },
    })
    await sdk.mount()
    await sdk.send('加个标签')
    assert(bind.tags.join(',') === 'a,b' && bind.title === '新标题', '✓ dryRun 未落地 + patches 原子落地(tags/title 均新)')
    assert(events.length === 1 && events[0].operation === 'edit', '✓ dryRun 零事件 + patches → 恰 1 次 data_change(operation=edit;修前 dryRun 也发 + patches 标 set)')
    sdk.unmount()
  }

  console.log('[e2e:events] ✓ team-audit P2#8 失败写不发 data_change(修前:args-only 推断,SCHEMA_INVALID/freeze 拒绝照样发,宿主为零变更触发保存)')
  {
    const events = []
    const bind = { title: 't', tags: ['a'], token: 'secret-token' }
    const llm = stubModel(
      // SCHEMA_INVALID:number 写 string 字段(dataOps 失败不 throw,返回 ERROR: 字符串且 status 恒 done)
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'title', value: 123 } } }] },
      // FROZEN_FIELD:受保护 freeze 字段直写被拒
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'token', value: 'hacked' } } }] },
      // 成功写对照(失败抑制不误伤成功路径)
      { toolCalls: [{ name: 'write', args: { patch: { op: 'append', jsonPath: 'tags', value: 'b' } } }] },
      { text: '完成' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-write-fail-noevent', storage: 'memory', llm, capabilities: { ...MIN_CAPS, vfs: true },
      data: {
        schema: z.object({ title: z.string(), tags: z.array(z.string()), token: z.string() }),
        bind,
        resources: [{ path: 'token', mode: 'freeze' }],
      },
      onEvent: (e) => { if (e.type === 'data_change') events.push(e) },
    })
    await sdk.mount()
    await sdk.send('写几个')
    assert(bind.title === 't' && bind.token === 'secret-token' && bind.tags.join(',') === 'a,b', '✓ 前置:两次失败写不落地 + 成功写落地')
    assert(events.length === 1 && events[0].operation === 'edit', `✓ P2#8 失败写(SCHEMA_INVALID + FROZEN_FIELD)零 data_change,仅成功写发 1 次(修前:失败写照发 3 次;实际 ${events.length})`)
    sdk.unmount()
  }

  console.log('[e2e:events] ✓ resource_update 同步 verbatim 真值进 bind → data_change(修前漏发面收口)')
  {
    const events = []
    const bind = { title: 't', token: 'secret-token' }
    const llm = stubModel(
      { toolCalls: [{ name: 'resource_update', args: { path: 'token', value: 'new-token' } }] },
      { text: '完成' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-resource-update-event', storage: 'memory', llm, capabilities: { ...MIN_CAPS, vfs: true },
      data: {
        schema: z.object({ title: z.string(), token: z.string() }),
        bind,
        resources: [{ path: 'token', mode: 'verbatim' }],
      },
      onEvent: (e) => { if (e.type === 'data_change') events.push(e) },
    })
    await sdk.mount()
    await sdk.send('更新 token')
    assert(bind.token === 'new-token', '✓ resource_update 落地(bind.token 已更新)')
    assert(events.length === 1 && events[0].operation === 'edit', '✓ resource_update → 恰发 1 次 data_change(operation=edit;修前不发)')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
