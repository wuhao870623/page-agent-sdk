/**
 * sec-136:useChat editAndResend(编辑已发送 user 消息并从该点重跑,edit-and-resend)
 * - 正常:改文本截断重跑(历史以改写 user 结尾)/ 附带字段(focuses/images/quote)保留 / onBeforeRegenerate 触发
 * - loading 中编辑 = 先 stop:排队清空留痕(onQueuedCleared),旧轮 finally 由 roundSeq 代次守卫失效
 * - 边界:非 user / 越界 no-op;空文本无图拒、纯图空文本落 IMAGE_ONLY_PLACEHOLDER
 * - 竞态核心:永不 settle 的流上 stop 后立即编辑(不等旧轮收口)→ 新轮 loading 不被旧 finally 拆掉,stop 仍可中止新轮
 */
import { useChat } from '../../composables/useChat'
import { IMAGE_ONLY_PLACEHOLDER } from '../../tools/imageInput'
import type { AgentMessage } from '../../types'
import type { TestCtx } from './_ctx'

/** 轮询等待条件成立(容错异步时序;抄 sec-40) */
async function waitFor(fn: () => boolean, timeoutMs = 800): Promise<boolean> {
  const start = Date.now()
  while (!fn() && Date.now() - start < timeoutMs) await new Promise((r) => setTimeout(r, 10))
  return fn()
}

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx

  // ===== 正常:改文本截断重跑 + 附带字段保留 + onBeforeRegenerate =====
  console.log('\n[useChat · editAndResend 正常路径]')
  {
    const seenHistories: AgentMessage[][] = []
    const resolvers: Array<(v: string) => void> = []
    let beforeRegen = 0
    const fetchStream = async (m: any[], onEvent: any) => {
      seenHistories.push(m.map((x) => ({ ...x })))
      return new Promise<string>((resolve) => {
        resolvers.push((v: string) => { onEvent({ type: 'text', delta: v }); resolve(v) })
      })
    }
    const focuses = [{ path: '$.components[0]' } as any]
    const images = [{ id: 'img1', thumb: 't', dataUri: 'd' } as any]
    const quote = { text: '引用原文', source: '标题' } as any
    const { state, sendMessage, editAndResend } = useChat({
      fetchStream: fetchStream as any,
      onBeforeRegenerate: () => { beforeRegen++ },
    })

    // 轮 1:带附带字段的消息 A
    void sendMessage('第一版输入', focuses as any, images as any, quote as any)
    await waitFor(() => resolvers.length === 1)
    resolvers[0]('回复一')
    await waitFor(() => !state.loading)
    // 轮 2:后续消息 B(编辑 A 时应被截断)
    void sendMessage('后续消息')
    await waitFor(() => resolvers.length === 2)
    resolvers[1]('回复二')
    await waitFor(() => !state.loading)
    assert(state.messages.length === 4, '✓ 前置:两轮共 4 条消息')

    // 编辑轮 1 的 user(index 0):改文本重跑
    void editAndResend(0, '修改后的输入')
    await waitFor(() => resolvers.length === 3)
    assert(state.messages.length === 2, '✓ 编辑重跑 → 截断该消息后全部(4→2:user+新占位)')
    const newMsg = state.messages[0]
    assert(newMsg.role === 'user' && newMsg.content === '修改后的输入', '✓ 编辑重跑 → user content 已改写')
    assert(newMsg.focuses?.length === 1 && newMsg.focuses[0].path === '$.components[0]', '✓ 编辑重跑 → focuses 保留(retry 路径丢字段坑的补全)')
    assert(newMsg.images?.length === 1 && newMsg.images[0].id === 'img1', '✓ 编辑重跑 → images 保留')
    assert(newMsg.quote?.text === '引用原文', '✓ 编辑重跑 → quote 保留')
    const hist = seenHistories[2]
    assert(hist.length === 1 && hist[0].content === '修改后的输入' && hist[0].role === 'user', '✓ 传给 fetchStream 的历史以改写后的 user 结尾(slice(0,-1) 语义)')
    assert(beforeRegen === 1, '✓ 编辑重跑 → onBeforeRegenerate 被调(清子 agent 复用缓存)')
    assert(state.loading === true, '✓ 编辑重跑 → loading=true(新轮在途)')

    resolvers[2]('重跑回复')
    await waitFor(() => !state.loading)
    assert(state.messages[1].role === 'assistant' && state.messages[1].content === '重跑回复', '✓ 重跑轮收口正常(新 assistant 落位)')
  }

  // ===== loading 中编辑 = 先 stop:排队清空留痕 + 旧轮收口不拆新轮 =====
  console.log('\n[useChat · editAndResend loading 竞态(stop + roundSeq 守卫)]')
  {
    const dropped: string[][] = []
    let streamCalls = 0
    // 永不自动 settle(模拟持续生成);abort 时 reject(与 sec-40 同款)
    const fetchStream = async (_m: any[], _oe: any, signal: any) => {
      streamCalls++
      return new Promise<string>((_, reject) => {
        if (signal) signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      })
    }
    const { state, sendMessage, editAndResend, stop, queuedTasks } = useChat({
      fetchStream: fetchStream as any,
      onQueuedCleared: (d) => { dropped.push([...d]) },
    })

    void sendMessage('A')
    void sendMessage('B') // 排队
    void sendMessage('C') // 排队
    assert(queuedTasks.value.length === 2 && streamCalls === 1, '✓ 前置:A 在途,B/C 排队')

    // 竞态核心:不等旧轮收口,立即编辑(旧 finally 尚在途)
    void editAndResend(0, '改写 A')
    assert(queuedTasks.value.length === 0, '✓ loading 中编辑 → 排队清空(B/C 属被截断分支)')
    assert(dropped.length === 1 && dropped[0].join(',') === 'B,C', '✓ loading 中编辑 → onQueuedCleared 收到 2 条(可见性留痕)')
    await waitFor(() => streamCalls === 2)
    assert(streamCalls === 2, '✓ 编辑重跑 → 新 fetchStream 已发起')
    assert(state.loading === true, '✓ 新轮 loading=true(旧轮 finally 未拆 —— roundSeq 代次守卫生效)')
    const firstUser = state.messages[0]
    assert(firstUser.content === '改写 A' && state.messages.length === 2, '✓ 编辑落地(user 改写 + 旧 assistant 占位被新占位替换)')

    // 旧轮 finally 现在已到达或稍后到达(微任务级):再等一拍确认 loading 仍 true
    await new Promise((r) => setTimeout(r, 30))
    assert(state.loading === true, '✓ 旧轮 finally 到达后 loading 仍 true(过气轮整体 no-op,核心竞态断言)')

    // stop 仍能中止新轮
    stop()
    await waitFor(() => !state.loading)
    assert(state.loading === false, '✓ stop → 新轮可正常中止(roundSeq 不影响 stop 语义)')
  }

  // ===== 边界:非 user / 越界 / 空内容 =====
  console.log('\n[useChat · editAndResend 边界]')
  {
    let streamCalls = 0
    const resolvers: Array<(v: string) => void> = []
    const fetchStream = async (_m: any[], onEvent: any) => {
      streamCalls++
      return new Promise<string>((resolve) => {
        resolvers.push((v: string) => { onEvent({ type: 'text', delta: v }); resolve(v) })
      })
    }
    const { state, sendMessage, editAndResend } = useChat({ fetchStream: fetchStream as any })
    void sendMessage('问一')
    await waitFor(() => resolvers.length === 1)
    resolvers[0]('答一')
    await waitFor(() => !state.loading)

    const before = state.messages.length
    void editAndResend(1, 'x') // index 1 是 assistant
    assert(state.messages.length === before && streamCalls === 1, '✓ 编辑 assistant 消息 → no-op(仅 user 可编辑)')
    void editAndResend(99, 'x') // 越界
    assert(state.messages.length === before && streamCalls === 1, '✓ 编辑越界 index → no-op')
    void editAndResend(0, '   ') // 空文本无图
    assert(state.messages.length === before && streamCalls === 1 && state.messages[0].content === '问一', '✓ 空文本且无图 → no-op(拒绝空重发)')

    // 纯图消息空文本编辑 → IMAGE_ONLY_PLACEHOLDER
    const withImg = useChat({ fetchStream: fetchStream as any })
    void withImg.sendMessage('图问', undefined, [{ id: 'i1', thumb: 't' } as any])
    await waitFor(() => resolvers.length === 2)
    resolvers[1]('图答')
    await waitFor(() => !withImg.state.loading)
    void withImg.editAndResend(0, '')
    await waitFor(() => resolvers.length === 3)
    const m0 = withImg.state.messages[0]
    assert(m0.content === IMAGE_ONLY_PLACEHOLDER && m0.images?.length === 1, '✓ 纯图消息空文本编辑 → content 落 IMAGE_ONLY_PLACEHOLDER 且图片保留')
    resolvers[2]('图答二')
    await waitFor(() => !withImg.state.loading)
  }

  // ===== 非流式路径:finishRound(seq) 改签名不回归 =====
  console.log('\n[useChat · 非流式路径收口不回归]')
  {
    let calls = 0
    const fetchResponse = async () => { calls++; return '非流式回复' }
    const { state, sendMessage, editAndResend } = useChat({ fetchResponse: fetchResponse as any })
    void sendMessage('普通问题')
    await waitFor(() => !state.loading)
    assert(calls === 1 && state.messages.length === 2, '✓ 非流式 sendMessage 正常收口')
    void editAndResend(0, '改一下')
    await waitFor(() => calls === 2 && !state.loading)
    assert(calls === 2 && state.messages[0].content === '改一下' && state.messages[1].content === '非流式回复', '✓ 非流式 editAndResend 正常重跑收口')
  }
}
