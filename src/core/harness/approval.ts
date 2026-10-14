/**
 * Approval 中间件 —— 工具调用前人工确认(human-in-the-loop)
 *
 * 经 wrapToolCall 拦截需确认的工具调用,发 approval_request 事件(带 resolve 回调),
 * UI 收到后弹确认框,用户「允许/拒绝」调 resolve → 中间件 Promise 收口:允许则执行,拒绝则返回 error。
 *
 * - 不需确认的工具直接放行(next)
 * - abort 联动:用户停止生成(signal.aborted)→ 自动拒绝,不永久挂起
 * - 超时(timeoutMs)→ 自动拒绝(默认 0 = 不超时,等用户)
 * - 拒绝时返回结构化 error,LLM 可据此改方案(如换路径、改只读)
 *
 * 装载顺序:在 permissions 之后(白名单先自动拒,幸存的写操作再人工确认)。
 */
import type { Middleware, ToolCallContext, ToolExecResult } from './middleware'

export interface ApprovalOptions {
  /** 需确认的工具名列表;不传 confirm 且不传 tools → 所有工具都确认 */
  tools?: string[]
  /** 自定义判定(优先于 tools);返回 true 需确认 */
  confirm?: (name: string, args: any) => boolean
  /**
   * 一次性授权(4.26,opt-in 默认关):开启后 approval_request 载荷带 remember 标志,内置确认条
   * 出现「允许并不再询问(本会话)」入口;用户点它 → 该工具名进 grants 集,**本会话内**后续调用
   * 免确认直通(先于 confirm 回调判定 —— 授权就是用户对「这个动作别再问了」的显式回答)。
   * grants 集由装配层注入并持有生命周期:switchSession/resetSession 清空,宿主可经
   * sdk.revokeApprovalGrants() 主动撤销。拒绝/超时/abort 永不授权。默认关 = 现行为逐次确认,零变化。
   */
  remember?: boolean
  /** 会话级授权集(装配层持有;中间件只读写,不管理生命周期) */
  grants?: Set<string>
  /** 超时毫秒(用户未响应自动拒绝);0 = 不超时。SDK 装配层对无 UI 路径注入默认 30s(flow-robustness P1#3) */
  timeoutMs?: number
  /** 超时自动拒的留痕回调(observable 接线由调用方负责;abort/用户先收口不触发) */
  onAutoReject?: (info: { toolName: string; waitedMs: number }) => void
  /**
   * 审批 diff 预览计算(ui-quick-wins Q3;装配层注入,中间件保持通用):挂起前对需确认调用做只读预览,
   * 结果附在 approval_request 载荷 preview 字段(UI 渲染 old→new)。返回 null/抛错 → 无 preview,不影响挂起流。
   * **组合语义(approval-preview-fix,2026-09-20)**:集成方传入的 previewWrite 优先(自定义工具的审批预览
   * 通道 —— 写目标由宿主态决定、不在 args 里时,如「标用户选中的那段」);返回 null 再落 dataOps write 的
   * 内置 dryRun 预览(approval.preview 显式开才接)。修前装配层把集成方回调静默覆盖丢弃。
   */
  previewWrite?: (name: string, args: any) => ApprovalWritePreview | null
}

/** 授权形裁决(仅 UI「允许并不再询问」入口产它):approved=true 且 remember=true → 允许本次并授予会话级免确认 */
export interface ApprovalGrantResolve {
  approved: boolean
  remember?: boolean
}

/** write 审批 diff 预览项(ui-quick-wins Q3):一个被写路径的 old→new 摘要 */
export interface ApprovalPreviewItem {
  op?: string
  jsonPath?: string
  oldSummary?: string
  newSummary?: string
}

/** write 审批 diff 预览结果(ui-quick-wins Q3):三意图只读计算(dryRun 纯函数通道,不落盘)。
 *  intent 为 string(approval-preview-fix 放宽):内置 write 预览用 set/edit/delete,集成方自定义工具
 *  可给任意语义标签(如 'annotate')—— ApprovalBar 只渲染 items/error,intent 不进 UI */
export interface ApprovalWritePreview {
  ok: boolean
  intent: string
  items: ApprovalPreviewItem[]
  /** ok=false 时的校验失败说明(预览即看到会被拒的原因) */
  error?: string
}

export function createApprovalMiddleware(opts: ApprovalOptions = {}): Middleware {
  const needConfirm = (name: string, args: any): boolean => {
    if (opts.confirm) return !!opts.confirm(name, args)
    // tools 显式给出(含空数组)→ 仅确认列表内;未给 tools → 确认所有
    if (opts.tools !== undefined) return opts.tools.includes(name)
    return true
  }

  return {
    name: 'approval',
    wrapToolCall: async (ctx: ToolCallContext, next: (ctx: ToolCallContext) => Promise<ToolExecResult>) => {
      // 会话级一次性授权直通(先于 needConfirm):已授权的工具名免确认执行,留痕供时间线自解释
      if (opts.remember && opts.grants?.has(ctx.name)) {
        ctx.logSink?.({ timestamp: Date.now(), type: 'middleware', data: { stage: 'approval_auto_allowed', toolName: ctx.name } })
        return next(ctx)
      }
      if (!needConfirm(ctx.name, ctx.args)) return next(ctx)

      return new Promise<ToolExecResult>((resolve) => {
        let settled = false
        const cleanup: Array<() => void> = []

        const finish = (approved: boolean | string | ApprovalGrantResolve) => {
          if (settled) return
          settled = true
          cleanup.forEach((fn) => fn())
          // 对象形 = 授权入口:{approved:true, remember:true} 允许本次并授予会话级免确认;
          // {approved:false} 按拒绝处理(不授予)。boolean/string 语义与旧版逐字一致
          const grantResolve = typeof approved === 'object' && approved !== null ? approved : null
          const ok = grantResolve ? grantResolve.approved === true : approved !== false
          const granted = Boolean(grantResolve?.remember) && ok
          if (granted) opts.grants?.add(ctx.name)
          ctx.logSink?.({ timestamp: Date.now(), type: 'middleware', data: { stage: 'approval_resolved', toolName: ctx.name, approved: !ok ? false : granted ? 'granted' : String(approved).slice(0, 60) } })
          if (!ok) {
            // 兼容 vfs path / 数据 jsonPath / write 的 patch.jsonPath / patches[],让 LLM 知道被拒的精确范围
            const a = (ctx.args ?? {}) as Record<string, any>
            const scope =
              a.path || a.jsonPath || a.patch?.jsonPath ||
              (Array.isArray(a.patches) ? a.patches.map((p: any) => p?.jsonPath).filter(Boolean).join(',') : '') ||
              ''
            resolve({
              content: `用户拒绝了 ${ctx.name} 调用${scope ? `(path=${scope})` : ''}。请改用只读工具、调整路径或换方案后再试。`,
              status: 'error' as const,
            })
          } else {
            // true / string(选方案)/ {approved:true,…}(可能带授权)→ 视为允许,执行工具
            next(ctx).then(resolve, (e: any) =>
              resolve({ content: `工具执行失败:${e?.message ?? e}`, status: 'error' as const }),
            )
          }
        }

        // abort 联动:进入时已 abort → 立即拒绝;否则监听 abort(用户停止生成 → 自动拒绝,防永久挂起)
        if (ctx.signal) {
          if (ctx.signal.aborted) return finish(false)
          const onAbort = () => finish(false)
          ctx.signal.addEventListener('abort', onAbort, { once: true })
          cleanup.push(() => ctx.signal?.removeEventListener('abort', onAbort))
        }

        // 超时自动拒绝(flow-robustness P1#3:SDK 装配层默认 30s —— 无响应方路径自动拒;
        // 响应方收到事件调 hold() 接管(内置 UI 即如此),无人应答才计时收口;abort/用户先收口时 settled 已置,不误报)
        let hold: (() => void) | undefined
        if (opts.timeoutMs && opts.timeoutMs > 0) {
          const startedAt = Date.now()
          let held = false
          const timer = setTimeout(() => {
            if (settled || held) return
            const waitedMs = Date.now() - startedAt
            finish(false)
            opts.onAutoReject?.({ toolName: ctx.name, waitedMs })
          }, opts.timeoutMs)
          cleanup.push(() => clearTimeout(timer))
          hold = () => { held = true; clearTimeout(timer) } // 幂等:重复调/收口后调均无害
        }

        // write 审批 diff 预览(ui-quick-wins Q3):只读计算挂载荷;失败静默省略(不影响挂起流)
        let preview: ApprovalWritePreview | undefined
        if (opts.previewWrite) {
          try { preview = opts.previewWrite(ctx.name, ctx.args) ?? undefined } catch { preview = undefined }
        }

        // 发确认请求事件:UI 调 resolve(approved) 收口;确认接管者调 hold() 取消无响应计时。
        // remember 标志(4.26 一次性授权):UI 据此显隐「允许并不再询问(本会话)」入口
        ctx.emit?.({
          type: 'approval_request',
          toolName: ctx.name,
          args: ctx.args,
          resolve: finish,
          hold,
          ...(preview ? { preview } : {}),
          ...(opts.remember ? { remember: true } : {}),
        } as any)
        // 挂起/收口双留痕(2026-09-02,nested-demo 诊断驱动):exportDiagnostics/debugLogs 此前只见
        // tool_call 派发后无限 'running' 无 tool_result,无法判断「卡在等确认」—— 现在挂起即见
        // approval_pending,用户裁决/自动拒/abort 后见 approval_resolved,时间线自解释(收口留痕在 finish 内)
        ctx.logSink?.({ timestamp: Date.now(), type: 'middleware', data: { stage: 'approval_pending', toolName: ctx.name } })
      })
    },
  }
}
