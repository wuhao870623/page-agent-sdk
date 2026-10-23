/**
 * 裁决结局一次性注入段工厂(content-trust-and-observability 收敛)—— proposalNotice / actionNotice
 * 两处内联中间件的共享骨架(原 actionOutcome.ts 自认「与 proposalNotice 并立同构不统一」)。
 *
 * 工厂只收敛「注入 + 一次性消费」骨架;renderLine / 队列 / 事件 / 幂等语义留在各自通道
 * (proposals.ts / actionOutcome.ts)零迁移 —— 装配条件与装载位次由调用方维持不变。
 * 一次性语义严守 4.18 S1 幂等契约:augmentPrompt 只读 notices(同轮多次调用不吞队列),
 * 消费(clear)在 afterAgent(abort 路径亦必跑,B5);裁决在在途轮中途到达 → 自然落下一轮。
 */
import type { Middleware } from '../harness/middleware'

export interface OutcomeNoticeOptions {
  /** 中间件名即段名(PIN_SEGMENT_NAMES 键,超预算保活) */
  name: string
  /** 段头(【内容提案裁决结果】/【宿主动作裁决结果】整行,含「以此为准」口径) */
  header: string
  /** 待注入行(只读消费面;空队列不注段) */
  getNotices: () => readonly string[]
  /** 清空队列(afterAgent 一次性消费;switchSession/resetSession 会话级也走它) */
  clear: () => void
}

export function createOutcomeNoticeMiddleware(opts: OutcomeNoticeOptions): Middleware {
  return {
    name: opts.name,
    augmentPrompt: () => {
      const notices = opts.getNotices()
      return notices.length ? [opts.header, ...notices].join('\n') : undefined
    },
    afterAgent: () => { opts.clear() },
  }
}
