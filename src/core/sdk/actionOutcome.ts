/**
 * deferredWrite 动作结局回传(action-resolve-outcome,2026-10-16)—— 宿主裁决闭环的通道层。
 *
 * 定位:4.20 的 `deferredWrite` 标记只做了「防谎报」半边(零工具门禁事实清单注记「待确认」);
 * 用户在工具调用之外(面板/确认条)采纳或放弃后,模型一直不知道结果。本通道把结局变成
 * **下一轮一次性系统段**(中间件在 createChatSdk 装配,与 proposalNotice 并立同构不统一)。
 *
 * 语义(resolveAction):
 * - **严格门禁**:只接受装配期标记 deferredWrite 的动作名(名字集由装配层注入);未标记/未知名
 *   返 false + warn —— 「待确认」口径(门禁)与「已确认」口径(结局段)必须罩同一批动作,
 *   宽松会出现两处自相矛盾(清单说已生效、段说被拒)。
 * - **名字键 + 同名覆盖**:actions 消费形态是「单挂起」(面板一次一草稿,新 show 替换旧);
 *   同名字不同结局 = 新一轮裁决,替换旧笔(返 true);**相同结局重报 = 幂等,返 false**。
 * - 一次性注入由中间件承担:augmentPrompt 只读 notices,消费(clear)在 afterAgent —— 同轮
 *   多次 augmentPrompt 调用不会吞掉队列(4.18 S1 幂等契约,proposalNotice 同款写法)。
 */
import type { SdkEvent } from '../types'

/** 结局词汇:与 resolveProposal 同款二值;部分采纳表达为 applied + detail */
export type ActionOutcome = 'applied' | 'discarded'

/** 单笔裁决的渲染行(注入段逐行;文案 SDK 定死 —— 措辞是防线的一部分,宿主只能给 detail) */
const renderLine = (name: string, outcome: ActionOutcome, detail?: string): string =>
  `· 动作 ${name} 的结果已被用户${outcome === 'applied' ? '采纳(已生效)' : '放弃(未生效)'}${detail ? `:${detail}` : ''} —— 已生效的可作事实引用;被放弃的不要当作已完成;不要重复提议已生效的内容。`

/** 队列封顶(与 proposals notices 同口径:防宿主高频上报撑爆段) */
const MAX_NOTICES = 5

export interface ActionOutcomeDeps {
  /** 装配期收集的 deferredWrite 动作名集合(4.20 action-host-semantics 既有面,复用不重建) */
  deferredNames: Set<string>
  emit: (e: SdkEvent) => void
  /** debugLogs 留痕(stage action_resolved;与 4.26.2 的 action_failed 同族) */
  log: (name: string, outcome: ActionOutcome, detail?: string) => void
}

export interface ActionOutcomeChannel {
  /** 宿主裁决回传:成功入队返 true;未标记/未知名或相同结局重报返 false(幂等) */
  resolve: (name: string, outcome: ActionOutcome, detail?: string) => boolean
  /** 待注入行(只读消费面;中间件 augmentPrompt 读、afterAgent clear) */
  readonly notices: string[]
  /** 清空队列(switchSession/resetSession 会话级;afterAgent 一次性消费) */
  clear: () => void
}

export function createActionOutcomeChannel(deps: ActionOutcomeDeps): ActionOutcomeChannel {
  // 名字 → 渲染行;Map 保插入序,覆盖时 delete+set 移到队尾(最新裁决最后注入)
  const queue = new Map<string, { line: string; outcome: ActionOutcome }>()
  /** 稳定引用的 notices 数组(queue 投影;中间件只读,改写只经 resolve/clear) */
  const notices: string[] = []

  const sync = () => {
    notices.length = 0
    for (const { line } of queue.values()) notices.push(line)
  }

  const channel: ActionOutcomeChannel = {
    resolve(name, outcome, detail) {
      if (!deps.deferredNames.has(name)) {
        console.warn(`[page-agent-sdk][actionOutcome] resolveAction("${name}") 被拒:该动作未标记 deferredWrite(或未注册)—— 结局回传只罩延迟生效类动作`)
        return false
      }
      if (outcome !== 'applied' && outcome !== 'discarded') return false
      const existing = queue.get(name)
      if (existing && existing.outcome === outcome) return false // 幂等:相同结局重报
      queue.delete(name)
      queue.set(name, { outcome, line: renderLine(name, outcome, detail) })
      while (queue.size > MAX_NOTICES) {
        const oldest = queue.keys().next().value
        if (oldest === undefined) break
        queue.delete(oldest)
      }
      deps.log(name, outcome, detail)
      deps.emit({ type: 'action_resolved', name, outcome, ...(detail !== undefined ? { detail } : {}) })
      sync()
      return true
    },
    notices,
    clear() {
      queue.clear()
      sync()
    },
  }
  return channel
}
