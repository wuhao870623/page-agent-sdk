<script setup lang="ts">
/**
 * actions(宿主动作)集成模板:textarea 持偏好真相源 + 两个宿主动作 + 裁决回传闭环。
 *
 * 演示链路:用户对 AI 说「把主题改成深色」→ AI 调 update_preferences(带 instruction 参数)→
 * 宿主弹出草稿面板 → 用户点「保存」→ 偏好写入 textarea + sdk.resolveAction(name, 'applied', detail)→
 * AI 下一轮被自动告知结局(【宿主动作裁决结果】一次性段),不再凭「草稿等确认」的旧回执作答。
 *
 * 三个看点:
 * 1. `params`(zod):入参即校验,instruction 缺失/超长在进 run 之前就被拦;
 * 2. `deferredWrite: true`:SDK 知道「调用成功 ≠ 已生效」—— 零工具门禁注记「待用户确认」,
 *    且 resolveAction 裁决回传只罩标了它的动作(4.27);
 * 3. run 抛错 → 模型收到结构化 `ERROR: {"code":"ACTION_FAILED",…}`(4.26.2),不是裸字符串,
 *    配 hint 引导换思路而非原样重发(sync_preferences_remote 演示这条失败通道)。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { z } from 'zod'
import { createChatSdk, type ChatSdk } from '../../src/core'
import DevNav from '../_shared/DevNav.vue'

const root = ref<HTMLElement>()
const source = ref('主题:自动\n语言:中文\n密度:舒适\n')
let agent: ChatSdk | null = null
/** 草稿面板态:deferredWrite 动作的「等确认」窗口(保存/放弃都在宿主,SDK 零写权限) */
const draft = ref('')
const panelOpen = ref(false)
const notice = ref('')
/** action_resolved 事件流水(onEvent 可观察裁决;与下轮一次性段互不替代) */
const events = ref<Array<{ name: string; outcome: string; detail?: string }>>([])

const saveDraft = (): void => {
  if (!agent) return
  const text = draft.value.trim()
  if (!text) return
  source.value = `${source.value.trimEnd()}\n${text}`   // 宿主写回:SDK 不知道也不经手怎么落盘
  agent.resolveAction('update_preferences', 'applied', '已写入偏好清单')
  panelOpen.value = false
  notice.value = `已保存:「${text}」—— AI 下一轮会知道这条已生效`
}
const discardDraft = (): void => {
  if (!agent) return
  agent.resolveAction('update_preferences', 'discarded')
  panelOpen.value = false
  notice.value = '已放弃草稿,偏好清单未变 —— AI 下一轮会知道这条未生效'
}

onMounted(() => {
  agent = createChatSdk({
    id: 'actions-demo',
    container: '#chat-root',
    llm: {
      apiKey: import.meta.env.VITE_AI_API_KEY,
      baseUrl: import.meta.env.VITE_AI_BASE_URL,
      model: import.meta.env.VITE_AI_MODEL,
      temperature: 0.3,
    },
    storage: 'memory',
    debug: true,
    capabilities: { dataOps: false },
    systemPrompt: '你是这个偏好设置页的助手。用户提出偏好修改时调 update_preferences 生成草稿(等用户在页面面板确认,不要说已生效);用户要求同步云端时调 sync_preferences_remote(该集成当前故障,失败后如实告知,不要原样重试)。',
    actions: {
      update_preferences: {
        description: '更新用户偏好清单(每行一条「键:值」)。用户提出偏好修改(如「把主题改成深色」「记住我喜欢紧凑密度」)时调用,instruction 参数带用户原话或忠实概括。它只生成草稿 —— 用户要在页面面板点「保存」才写入,调用成功不等于已保存,不要对用户说偏好已更新。',
        readsHostState: true,
        deferredWrite: true,
        params: z.object({ instruction: z.string().min(1).max(500) }),
        run: ({ instruction }) => {
          draft.value = instruction
          panelOpen.value = true
          return `草稿已生成并在页面面板打开:「${instruction}」。等用户点「保存」或「放弃」;在此之前偏好清单未变,不要对用户说偏好已更新。`
        },
      },
      sync_preferences_remote: {
        description: '把当前偏好清单同步到云端。用户明确要求同步/备份到云端时调用。(演示失败通道:该集成当前故障,调用会失败 —— 收到结构化错误后如实告知用户并建议稍后再试,不要原样重发相同的调用。)',
        readsHostState: true,
        run: async () => {
          throw new Error('云端服务连接失败(演示):上游 503')
        },
      },
    },
    onEvent: (e) => {
      if (e.type === 'action_resolved') events.value.push({ name: e.name, outcome: e.outcome, detail: e.detail })
    },
    dialog: { drawer: true, drawerHidden: true, title: '偏好助手', placeholder: '让 AI 改你的偏好,如「把主题改成深色」…' },
  })
  agent.mount()
  ;(window as any).__sdk = agent
})
onUnmounted(() => agent?.unmount())

const openDrawer = (): void => agent?.show()
</script>

<template>
  <div class="act-page">
    <DevNav />
    <header class="act-hero">
      <h1>宿主动作与裁决回传(actions + resolveAction)</h1>
      <p>AI 调 update_preferences 只生成草稿,你点「保存」才写入 —— resolveAction 把结局回传,AI 下一轮经一次性系统段知道「已生效 / 未生效」;sync_preferences_remote 永远失败,演示结构化错误通道。</p>
    </header>

    <div class="act-main">
      <section class="act-editor">
        <h2>⚙️ 偏好清单(textarea 真相源)</h2>
        <textarea v-model="source" class="act-source" spellcheck="false" data-test="source" aria-label="偏好清单" />
        <p v-if="notice" class="act-notice" data-test="notice">{{ notice }}</p>
      </section>

      <section v-if="panelOpen" class="act-panel" data-test="draft-panel">
        <header class="act-panel-head">
          <strong>AI 偏好草稿 · 待确认</strong>
          <span class="act-meta">保存 = 写入清单并告知 AI 已生效;放弃 = 完全不动</span>
        </header>
        <textarea v-model="draft" class="act-draft" spellcheck="false" data-test="draft-text" aria-label="偏好草稿(可手改)" />
        <footer class="act-panel-bar">
          <span class="act-actions">
            <button type="button" class="act-btn" data-test="discard-btn" @click="discardDraft">放弃</button>
            <button type="button" class="act-btn accent" data-test="save-btn" @click="saveDraft">保存并写回</button>
          </span>
        </footer>
      </section>

      <section v-if="events.length" class="act-events" data-test="events">
        <h2>📡 action_resolved 事件</h2>
        <div v-for="(e, i) in events" :key="i" class="act-event" :class="e.outcome">
          {{ e.name }} → {{ e.outcome }}{{ e.detail ? `:${e.detail}` : '' }}
        </div>
      </section>
    </div>

    <button class="ask-btn" data-test="ask-btn" @mousedown.prevent @click="openDrawer">问 AI</button>
    <div id="chat-root" ref="root"></div>
  </div>
</template>

<style scoped>
.act-page { max-width: 960px; margin: 0 auto; padding: 24px 20px 120px; }
.act-hero h1 { font-size: 24px; margin: 12px 0 4px; }
.act-hero p { color: #6b7280; font-size: 13.5px; margin: 0 0 18px; }
.act-main { display: grid; gap: 16px; }
.act-editor h2, .act-events h2 { font-size: 15px; margin: 0 0 8px; }
.act-source { width: 100%; min-height: 160px; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; font: 13px/1.7 ui-monospace, monospace; resize: vertical; }
.act-notice { color: #047857; font-size: 13px; }
.act-panel { border: 1px solid #c7d2c9; border-radius: 10px; overflow: hidden; background: #fff; }
.act-panel-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 10px 14px; background: #f0f7f1; }
.act-meta { color: #374151; font-size: 12.5px; }
.act-draft { width: 100%; min-height: 64px; padding: 10px 14px; border: none; border-top: 1px solid #e5e7eb; font: 13px/1.7 ui-monospace, monospace; resize: vertical; box-sizing: border-box; outline: none; }
.act-panel-bar { display: flex; justify-content: flex-end; padding: 10px 14px; border-top: 1px solid #e5e7eb; }
.act-actions { display: flex; gap: 8px; }
.act-btn { padding: 8px 16px; border-radius: 8px; border: 1px solid #d1d5db; background: #fff; cursor: pointer; font-size: 13px; }
.act-btn.accent { background: #1f4d3a; color: #fff; border-color: #1f4d3a; }
.act-events { border: 1px dashed #d1d5db; border-radius: 10px; padding: 10px 14px; }
.act-event { font: 12.5px/1.8 ui-monospace, monospace; }
.act-event.applied { color: #116632; }
.act-event.discarded { color: #8a2b2b; }
.ask-btn { position: fixed; right: 28px; bottom: 28px; z-index: 30; padding: 10px 18px; border-radius: 999px; border: none; cursor: pointer; background: #1f4d3a; color: #fff; font-size: 14px; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18); }
</style>
