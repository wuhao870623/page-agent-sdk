/**
 * sec-138 —— content-proposals 读通道故障口径(4.26.1)
 *
 * 背景(2026-10-14 真机诊断驱动):宿主 dev server 未运行 → 集成方 `read` 回调抛
 * `TypeError: Failed to fetch`,模型同一句「读取失败:…」原样重调 5 次、多跑 4 个往返;
 * 而诊断导出的 32 条 debugLogs 里**没有一条**记录该故障 —— 成功有 `deps.log('read')`、
 * 基底漂移有 `deps.log('rejected')`,唯独「读不到」静默。修法:两处失败分支收敛到一个
 * `readFailure` —— ① `deps.log('read_failed')` 留痕(带 tool 分流) ② 回执换 SDK 统一口径
 * `ERROR: {json}`(与 read_page 等一致)+ hint 明说「原样重试不会成功」。
 *
 * A. read 抛错:结构化 ERROR + 原始错误串透传;旧裸文案不再出现
 * B. propose 读抛错:同口径(前置「提案被拒」语义保留)
 * C. 留痕:kind='read_failed' + tool 分流 + message 截断 ≤300
 * D. 边界:`read` 返回 null ≠ 抛错 —— 空结果仍走原文案(不误套 ERROR,模型不该去重试)
 * E. 故障不外发事件(与 'rejected'/'replaced' 一致:只留痕,不新增公共事件面)
 * F. 看门狗标记回归护栏:两工具带 __pgWatchdog(集成方回调,无自有闸 —— 见 toolWatchdog.ts 豁免面注记)
 */
import type { TestCtx } from './_ctx'
import { createProposalChannel } from '../../sdk/proposals'
import { TOOL_WATCHDOG_MARK } from '../../harness/toolWatchdog'

/** 取回执里的结构化体(toolError 形态 `ERROR: {json}`);非该形态返回 null */
function errBody(content: string): Record<string, unknown> | null {
  if (!content.startsWith('ERROR: ')) return null
  try {
    return JSON.parse(content.slice('ERROR: '.length)) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('[sec-138] content-proposals 读通道故障口径(留痕 + 结构化 ERROR)')

  const mk = (read: () => never | null | { content: string; label?: string }) => {
    const logs: Array<{ kind: string; data: Record<string, unknown> }> = []
    const events: unknown[] = []
    const channel = createProposalChannel(
      { read: read as never, onProposal: () => 'ok' },
      { emit: (e) => events.push(e), log: (kind, data) => logs.push({ kind, data: data ?? {} }) },
    )
    const tools = Object.fromEntries(channel.tools.map((t) => [t.name, t])) as Record<string, any>
    return { channel, logs, events, tools }
  }

  const BOOM = () => { throw new TypeError('Failed to fetch') }

  // ===== A. read 抛错 → 结构化 ERROR,原始错误串透传 =====
  {
    const { tools } = mk(BOOM)
    const content = String(await tools.read_content.invoke({}))
    const body = errBody(content)
    assert(body !== null, `✓ read 抛错 → toolError 形态 ERROR: {json}(实得 ${content.slice(0, 40)})`)
    assert(body?.error === 'CONTENT_READ_FAILED', `✓ 错误码 CONTENT_READ_FAILED(实得 ${String(body?.error)})`)
    assert(String(body?.message).includes('TypeError: Failed to fetch'), '✓ 原始错误串原样透传(TypeError: Failed to fetch)')
    assert(/原样重试不会成功/.test(String(body?.hint)), '✓ hint 明说「原样重试不会成功」(修前只有「请如实告知用户」,压不住重试)')
    assert(!content.includes('读取失败:TypeError') || body !== null, '✓ 不再是裸中文串(旧「读取失败:{err}。」形态退场)')
  }

  // ===== B. propose 读抛错 → 同口径 =====
  {
    const { tools } = mk(BOOM)
    const content = String(await tools.propose_content.invoke({ summary: '改一处', baseHash: 'h', content: '新内容' }))
    const body = errBody(content)
    assert(body?.error === 'CONTENT_READ_FAILED', `✓ propose 读抛错 → 同错误码(实得 ${String(body?.error)})`)
    assert(String(body?.message).includes('提案被拒') && String(body?.message).includes('Failed to fetch'),
      '✓ 「提案被拒」语义保留 + 错误串透传')
  }

  // ===== C. 留痕:kind='read_failed' + tool 分流 + message 截断 =====
  {
    const long = () => { throw new Error('x'.repeat(500)) }
    const { tools, logs } = mk(long)
    await tools.read_content.invoke({})
    await tools.propose_content.invoke({ summary: 's', baseHash: 'h', content: 'c' })
    const failed = logs.filter((l) => l.kind === 'read_failed')
    assert(failed.length === 2, `✓ 两次读故障各留痕一条(实得 ${failed.length})`)
    assert(failed[0]?.data.tool === 'read' && failed[1]?.data.tool === 'propose',
      `✓ tool 字段分流 read/propose(实得 ${failed.map((l) => String(l.data.tool)).join(',')})`)
    assert(String(failed[0]?.data.message).length === 300, `✓ message 截断 300 字符(实得 ${String(failed[0]?.data.message).length})`)
  }

  // ===== D. 边界:read 返回 null ≠ 抛错(空结果不套 ERROR,模型不该重试) =====
  {
    const { tools, logs } = mk(() => null)
    const read = String(await tools.read_content.invoke({}))
    const propose = String(await tools.propose_content.invoke({ summary: 's', baseHash: 'h', content: 'c' }))
    assert(errBody(read) === null && read.includes('当前没有可编辑的内容对象'), '✓ read 返回 null → 原文案(非 ERROR 形态)')
    assert(errBody(propose) === null && propose.includes('没有可编辑的内容对象'), '✓ propose 返回 null → 原文案')
    assert(logs.filter((l) => l.kind === 'read_failed').length === 0, '✓ 空结果不留 read_failed(与故障分流)')
  }

  // ===== E. 故障不外发事件(公共事件面零新增) =====
  {
    const { tools, events } = mk(BOOM)
    await tools.read_content.invoke({})
    await tools.propose_content.invoke({ summary: 's', baseHash: 'h', content: 'c' })
    assert(events.length === 0, `✓ 读故障不外发事件(与 rejected/replaced 一致:只留痕,实得 ${events.length})`)
  }

  // ===== F. 看门狗标记回归护栏(集成方回调 read/onProposal 无自有闸) =====
  {
    const { tools } = mk(BOOM)
    const marked = [tools.read_content, tools.propose_content].every(
      (t) => (t as Record<string, unknown>)[TOOL_WATCHDOG_MARK] === true,
    )
    assert(marked, `✓ 两工具带 ${TOOL_WATCHDOG_MARK}(永不 settle 时 recoverable 回灌,不杀流)`)
  }
}
