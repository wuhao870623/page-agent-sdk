/**
 * sec-141:useChat retry/regenerate 附带字段与尾态补答(chat-refresh)
 * - retry(错误重试)保留附带字段:quote/focuses/images 随重建的 user 消息原样再进历史
 *   (修「重试把划词引用标签弄没了」:重建只带 content 会丢选中内容的引用/聚焦/图片)
 * - regenerate 尾消息是 user(停止/失败后未答):不截断历史直接以其结尾补答(提问不被误删)
 * - regenerate 常规路径(尾 assistant)回归:旧 assistant 移除换新占位,带引用的 user 原对象不动
 */
import { useChat } from '../../composables/useChat'
import type { AgentMessage } from '../../types'
import type { TestCtx } from './_ctx'

/** 轮询等待条件成立(容错异步时序;抄 sec-136) */
async function waitFor(fn: () => boolean, timeoutMs = 800): Promise<boolean> {
  const start = Date.now()
  while (!fn() && Date.now() - start < timeoutMs) await new Promise((r) => setTimeout(r, 10))
  return fn()
}

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx

  // ===== retry:附带字段保留(修「重试把选中的文本内容标签弄没了」)=====
  console.log('\n[useChat · retry 附带字段保留]')
  {
    const seenHistories: AgentMessage[][] = []
    let failFirst = true
    const resolvers: Array<(v: string) => void> = []
    const fetchStream = async (m: any[], onEvent: any) => {
      seenHistories.push(m.map((x) => ({ ...x })))
      if (failFirst) throw new Error('网络错误')
      return new Promise<string>((resolve) => {
        resolvers.push((v: string) => { onEvent({ type: 'text', delta: v }); resolve(v) })
      })
    }
    const focuses = [{ path: '$.components[0]' } as any]
    const images = [{ id: 'img1', thumb: 't', dataUri: 'd' } as any]
    const quote = { text: '引用原文', source: '标题' } as any
    const { state, sendMessage, retry } = useChat({ fetchStream: fetchStream as any })

    void sendMessage('带引用的提问', focuses as any, images as any, quote as any)
    await waitFor(() => !state.loading)
    assert(state.error === '网络错误', '✓ 前置:首轮流错误置位(retry 入口可用)')
    assert(state.messages.length === 1 && state.messages[0].role === 'user', '✓ 前置:失败空占位已移除(历史只剩 user)')

    failFirst = false
    void retry()
    await waitFor(() => resolvers.length === 1)
    const retried = state.messages[0]
    assert(retried.role === 'user' && retried.content === '带引用的提问', '✓ retry → user 消息以原文本重建')
    assert(retried.quote?.text === '引用原文', '✓ retry → quote 引用标签保留(选中内容不再丢)')
    assert(retried.focuses?.length === 1 && retried.focuses[0].path === '$.components[0]', '✓ retry → focuses 保留')
    assert(retried.images?.length === 1 && retried.images[0].id === 'img1', '✓ retry → images 保留')
    assert(state.error === null, '✓ retry → 错误清除')
    const hist = seenHistories[1]
    assert(hist.length === 1 && hist[0].quote?.text === '引用原文', '✓ retry → 引用随重发历史进 LLM 上下文')

    resolvers[0]('重试成功回复')
    await waitFor(() => !state.loading)
    assert(state.messages[1]?.role === 'assistant' && state.messages[1].content === '重试成功回复', '✓ retry 重跑收口正常')
  }

  // ===== regenerate 尾消息是 user:不截断直接补答 =====
  console.log('\n[useChat · regenerate 尾 user 补答(停止/失败后未答态)]')
  {
    const seenHistories: AgentMessage[][] = []
    const resolvers: Array<(v: string) => void> = []
    const fetchStream = async (m: any[], onEvent: any) => {
      seenHistories.push(m.map((x) => ({ ...x })))
      return new Promise<string>((resolve) => {
        resolvers.push((v: string) => { onEvent({ type: 'text', delta: v }); resolve(v) })
      })
    }
    let beforeRegen = 0
    const quote = { text: '未答提问的引用' } as any
    const { state, sendMessage, regenerate } = useChat({
      fetchStream: fetchStream as any,
      onBeforeRegenerate: () => { beforeRegen++ },
    })

    void sendMessage('第一问')
    await waitFor(() => resolvers.length === 1)
    resolvers[0]('答一')
    await waitFor(() => !state.loading)
    // 构造「停止/失败后未答」尾态:历史尾是 user(无 assistant 回复,引用随消息)
    state.messages.push({ role: 'user', content: '第二问', timestamp: Date.now(), quote } as AgentMessage)

    void regenerate()
    await waitFor(() => resolvers.length === 2)
    assert(state.messages.filter((m) => m.content === '第二问').length === 1, '✓ 尾 user 补答 → 提问不被删除(不走截断分支)')
    assert(state.messages.length === 4, '✓ 尾 user 补答 → 历史长度 4(问一/答一/问二 + 新占位)')
    const hist = seenHistories[1]
    const tail = hist[hist.length - 1]
    assert(hist.length === 3 && tail.content === '第二问' && (tail as any).quote?.text === '未答提问的引用', '✓ 尾 user 补答 → 历史以待答 user(含引用)结尾重发')
    assert(beforeRegen === 1, '✓ 尾 user 补答 → onBeforeRegenerate 被调(清子 agent 复用缓存)')

    resolvers[1]('补答')
    await waitFor(() => !state.loading)
    const last = state.messages[state.messages.length - 1]
    assert(last.role === 'assistant' && last.content === '补答', '✓ 尾 user 补答收口正常(新 assistant 落位)')
    assert(state.messages.filter((m) => m.content === '第二问').length === 1, '✓ 收口后提问仍在(补答不覆盖提问)')
  }

  // ===== regenerate 常规路径(尾 assistant)回归:旧回复移除、带引用 user 不动 =====
  console.log('\n[useChat · regenerate 常规路径回归]')
  {
    const seenHistories: AgentMessage[][] = []
    const resolvers: Array<(v: string) => void> = []
    const fetchStream = async (m: any[], onEvent: any) => {
      seenHistories.push(m.map((x) => ({ ...x })))
      return new Promise<string>((resolve) => {
        resolvers.push((v: string) => { onEvent({ type: 'text', delta: v }); resolve(v) })
      })
    }
    const quote = { text: '常规引用' } as any
    const { state, sendMessage, regenerate } = useChat({ fetchStream: fetchStream as any })

    void sendMessage('带引用提问', undefined, undefined, quote as any)
    await waitFor(() => resolvers.length === 1)
    resolvers[0]('答 v1')
    await waitFor(() => !state.loading)

    void regenerate()
    await waitFor(() => resolvers.length === 2)
    assert(state.messages.length === 2 && state.messages[1].role === 'assistant' && state.messages[1].content === '', '✓ 常规重生成 → 旧 assistant 移除换新占位')
    assert(state.messages[0].quote?.text === '常规引用', '✓ 常规重生成 → 带 quote 的 user 原对象不动(引用随历史重发)')
    const hist = seenHistories[1]
    assert(hist.length === 1 && hist[0].quote?.text === '常规引用', '✓ 常规重生成 → 引用随重发历史进 LLM 上下文')

    resolvers[1]('答 v2')
    await waitFor(() => !state.loading)
    assert(state.messages[1].content === '答 v2' && !state.messages.some((m) => m.content === '答 v1'), '✓ 常规重生成收口(旧回复被替换非追加)')
  }
}
