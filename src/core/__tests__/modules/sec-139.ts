/**
 * sec-139:deferredWrite 动作结局回传(action-resolve-outcome,2026-10-16)
 * - createActionOutcomeChannel:严格门禁(未标记/未知名 false + warn)/ 名字键覆盖(不同结局 = 新裁决)
 *   / 幂等(相同结局重报 false)/ 封顶 5 丢最旧 / 事件 action_resolved / log 留痕 / clear 清空
 * - 段文案纪律:动作名 + 已生效/未生效 + detail 随行 + 行为契约尾巴(勿重复提议已生效内容)
 */
import { createActionOutcomeChannel } from '../../sdk/actionOutcome'
import type { SdkEvent } from '../../types'
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx

  const mount = (names: string[]) => {
    const events: SdkEvent[] = []
    const logs: Array<{ name: string; outcome: string; detail?: string }> = []
    const channel = createActionOutcomeChannel({
      deferredNames: new Set(names),
      emit: (e) => events.push(e),
      log: (name, outcome, detail) => logs.push({ name, outcome, detail }),
    })
    return { channel, events, logs }
  }

  // ✓ resolve 严格门禁:未标记 / 未注册名 → false,零队列零事件零留痕
  {
    const { channel, events, logs } = mount(['update_profile'])
    assert(channel.resolve('save_draft', 'applied') === false, '✓ resolveAction → 未标记 deferredWrite 的动作拒(false)')
    assert(channel.resolve('nope', 'discarded') === false, '✓ resolveAction → 未注册名拒(false)')
    assert(channel.notices.length === 0 && events.length === 0 && logs.length === 0, '✓ 拒绝路径零副作用(不注入/不外发/不留痕)')
  }

  // ✓ applied 入队:行文含动作名/已生效/detail;事件与留痕随行
  {
    const { channel, events, logs } = mount(['update_profile'])
    assert(channel.resolve('update_profile', 'applied', '保存前有手改') === true, '✓ resolveAction applied → 入队返 true')
    assert(channel.notices.length === 1 && channel.notices[0].includes('update_profile') && channel.notices[0].includes('采纳(已生效)') && channel.notices[0].includes('保存前有手改'),
      '✓ 结局行含动作名 + 已生效语义 + detail 随行')
    assert(channel.notices[0].includes('不要重复提议已生效的内容') && channel.notices[0].includes('被放弃的不要当作已完成'),
      '✓ 段文案钉行为契约尾巴(勿重复提议/勿当作已完成)')
    assert(events.length === 1 && events[0].type === 'action_resolved' && (events[0] as { name: string }).name === 'update_profile', '✓ action_resolved 事件外发(name/outcome/detail)')
    assert(logs.length === 1 && logs[0].outcome === 'applied', '✓ log 留痕(name + outcome)')
  }

  // ✓ 名字键覆盖:同名字不同结局 = 新裁决(替换旧笔,队列仍 1 条);相同结局重报 = 幂等 false
  {
    const { channel } = mount(['update_skills'])
    assert(channel.resolve('update_skills', 'discarded') === true, '✓ 首报 discarded 入队')
    assert(channel.resolve('update_skills', 'applied', '重新起草后保存') === true, '✓ 同名字不同结局 → 新裁决覆盖(返 true)')
    assert(channel.notices.length === 1 && channel.notices[0].includes('采纳(已生效)') && channel.notices[0].includes('重新起草后保存'),
      '✓ 覆盖后队列只剩最终结局(discarded 旧笔被替换)')
    assert(channel.resolve('update_skills', 'applied', '再报一次') === false, '✓ 相同结局重报 → 幂等 false')
    assert(channel.notices.length === 1, '✓ 幂等路径队列不变')
  }

  // ✓ detail 缺省:行文无悬空冒号;非法 outcome 拒
  {
    const { channel } = mount(['a1'])
    assert(channel.resolve('a1', 'discarded') === true && channel.notices[0].includes('放弃(未生效)') && !channel.notices[0].includes('::'),
      '✓ detail 缺省渲染正常(无悬空分隔)')
    assert(channel.resolve('a1', 'weird' as never) === false, '✓ 非法 outcome 值拒(false)')
  }

  // ✓ 封顶 5:第 6 个名字挤掉最旧(FIFO);clear 清空(会话生命周期/一次性消费共用)
  {
    const { channel } = mount(['n1', 'n2', 'n3', 'n4', 'n5', 'n6'])
    for (const n of ['n1', 'n2', 'n3', 'n4', 'n5', 'n6']) channel.resolve(n, 'applied')
    assert(channel.notices.length === 5 && !channel.notices.some((l) => l.includes('动作 n1 ')) && channel.notices.some((l) => l.includes('动作 n6 ')),
      '✓ 队列封顶 5 丢最旧(n1 出局,n6 在列)')
    channel.clear()
    assert(channel.notices.length === 0, '✓ clear 清空(switch/reset 会话级 + afterAgent 一次性消费共用)')
    // clear 后同名字再报 = 新裁决(返 true,非幂等残留)
    assert(channel.resolve('n6', 'applied') === true && channel.notices.length === 1, '✓ clear 后再报 = 新裁决(队列无残留态)')
  }
}
