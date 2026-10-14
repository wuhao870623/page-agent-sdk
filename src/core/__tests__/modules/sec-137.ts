/**
 * sec-137 —— approval 一次性授权(remember/grants,4.26)
 *
 * 背景:批量写场景(标注连发/连续编辑)每次都弹确认条,用户要求「某个动作一次性授权,不再重复追问」。
 * 修法:opt-in `remember: true` + 装配层注入会话级 `grants` 集 —— 确认条「允许并不再询问(本会话)」以
 * `{approved:true, remember:true}` 收口 → 工具名进授权集,本会话内后续调用免确认直通(先于 confirm 回调)。
 * 安全面:拒绝/超时/abort 永不授权;clear(会话切换/重置/宿主撤销)后恢复询问;默认关零行为变化。
 *
 * A. 默认关:载荷无 remember 字段;对象形收口无 grants 时按 allowed 处理(防御,不崩)
 * B. remember 开:载荷带 remember:true;{approved:true,remember:true} 收口 → 本次执行 + 进授权集 + 留痕 granted
 * C. 已授权直通:不发 approval_request、不调 confirm 回调,直接执行 + 留痕 approval_auto_allowed
 * D. 拒绝不授权:{approved:false,remember:true} → error 结果且授权集为空
 * E. grants.clear()(会话切换/重置/撤销模拟)→ 恢复确认
 * F. humanConfirm 对象形兜底:按 approved 布尔收口(征询不参与授权,载荷不带 remember)
 */
import type { TestCtx } from './_ctx'
import { createApprovalMiddleware } from '../../harness/approval'
import { createHumanConfirmMiddleware, HUMAN_CONFIRM_TOOL_NAME } from '../../harness/humanConfirm'

interface CapturedEvt {
  remember?: boolean
  resolve: (c: boolean | string | { approved: boolean; remember?: boolean }) => void
  hold?: () => void
}

function mkCaptureCtx(name: string, args: Record<string, unknown> = {}, logs: unknown[] = []) {
  let captured: CapturedEvt | undefined
  const ctx = {
    name,
    args,
    emit: (evt: any) => { if (evt.type === 'approval_request') captured = evt },
    logSink: (entry: any) => logs.push(entry?.data ?? entry),
    signal: undefined,
  } as any
  return { ctx, evt: () => captured }
}

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('[sec-137] approval 一次性授权(remember/grants)')

  // next 兼容形态:忽略首参(ctx),固定回执;自定义回执用闭包另造
  const exec = async () => ({ content: '工具已执行', status: 'done' as const })

  // ===== A. 默认关:载荷无 remember;对象形收口(无 grants 注入)防御性按 allowed 处理 =====
  {
    const mw = createApprovalMiddleware({ tools: ['write'] })
    const { ctx: c, evt } = mkCaptureCtx('write')
    const p = mw.wrapToolCall!(c, exec)
    assert(evt() !== undefined, '✓ 默认关:确认照常挂起')
    assert((evt() as any).remember === undefined, '✓ 默认关:载荷不带 remember 字段(UI 不显示授权入口)')
    evt()!.resolve({ approved: true, remember: true }) // 无 grants 注入:不崩,按允许执行
    const r = await p
    assert(r.status === 'done' && r.content === '工具已执行', '✓ 默认关:对象形收口按允许执行(无授权集可写,防御路径)')
  }

  // ===== B. remember 开:载荷带标志;授权收口 → 本次执行 + 进授权集 + 留痕 granted =====
  {
    const grants = new Set<string>()
    const logs: unknown[] = []
    const mw = createApprovalMiddleware({ tools: ['write'], remember: true, grants })
    const { ctx: c, evt } = mkCaptureCtx('write', {}, logs)
    const p = mw.wrapToolCall!(c, exec)
    assert(evt()!.remember === true, '✓ remember 开:载荷带 remember:true(UI 显示「允许并不再询问」入口)')
    evt()!.resolve({ approved: true, remember: true })
    const r = await p
    assert(r.status === 'done', '✓ 授权收口:本次照常执行')
    assert(grants.has('write'), '✓ 授权收口:工具名进会话级授权集')
    const resolved = logs.find((d: any) => d?.stage === 'approval_resolved') as any
    assert(resolved?.approved === 'granted', `✓ 留痕 approval_resolved(approved='granted',实得 ${JSON.stringify(resolved?.approved)})`)
  }

  // ===== C. 已授权直通:不发事件、不调 confirm、直接执行 + 留痕 approval_auto_allowed =====
  {
    const grants = new Set<string>(['write'])
    const logs: unknown[] = []
    let confirmCalls = 0
    const mw = createApprovalMiddleware({ tools: ['write'], remember: true, grants, confirm: () => { confirmCalls += 1; return true } })
    const { ctx: c, evt } = mkCaptureCtx('write', {}, logs)
    const r = await mw.wrapToolCall!(c, async () => ({ content: '直通执行', status: 'done' as const }))
    assert(r.status === 'done' && r.content === '直通执行', '✓ 已授权:免确认直接执行')
    assert(evt() === undefined, '✓ 已授权:不发 approval_request(确认条根本不出现)')
    assert(confirmCalls === 0, `✓ 已授权:confirm 回调不被调用(授权优先于逐次盘点,实调 ${confirmCalls} 次)`)
    const auto = logs.find((d: any) => d?.stage === 'approval_auto_allowed') as any
    assert(auto?.toolName === 'write', '✓ 留痕 approval_auto_allowed(时间线自解释)')
  }

  // ===== D. 拒绝不授权:{approved:false,remember:true} → error 且授权集为空 =====
  {
    const grants = new Set<string>()
    const mw = createApprovalMiddleware({ tools: ['write'], remember: true, grants })
    const { ctx: c, evt } = mkCaptureCtx('write')
    const p = mw.wrapToolCall!(c, exec)
    evt()!.resolve({ approved: false, remember: true }) // 拒绝里带 remember 不生效
    const r = await p
    assert(r.status === 'error' && /用户拒绝了 write/.test(String(r.content)), '✓ 对象形拒绝 → error 结果(与布尔拒绝同文案)')
    assert(grants.size === 0, '✓ 拒绝不授权(remember 依附于 approved=true 才生效)')
  }

  // ===== E. grants.clear()(switchSession/resetSession/revokeApprovalGrants 等效模拟)→ 恢复确认 =====
  {
    const grants = new Set<string>(['write'])
    const mw = createApprovalMiddleware({ tools: ['write'], remember: true, grants })
    grants.clear()
    const { ctx: c, evt } = mkCaptureCtx('write')
    const p = mw.wrapToolCall!(c, exec)
    assert(evt() !== undefined, '✓ 授权集清空后:恢复逐次确认(会话级失效语义)')
    evt()!.resolve(true)
    assert((await p).status === 'done', '✓ 清空后常规允许照常执行')
  }

  // ===== F. humanConfirm 对象形兜底:按 approved 布尔收口(征询载荷不带 remember,UI 正常不发对象形) =====
  {
    const mw = createHumanConfirmMiddleware(undefined, { timeoutMs: 0 })
    const { ctx: c, evt } = mkCaptureCtx(HUMAN_CONFIRM_TOOL_NAME, { question: '继续吗?' })
    const p = mw.wrapToolCall!(c, () => exec())
    evt()!.resolve({ approved: true, remember: true })
    const r = await p
    assert(r.status === 'done' && /用户同意了方案/.test(String(r.content)), `✓ humanConfirm 对象形收口兜底为布尔(允许路径,实得 ${String(r.content).slice(0, 30)})`)
  }
}
