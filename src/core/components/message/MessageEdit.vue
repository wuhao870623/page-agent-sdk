<script setup lang="ts">
/**
 * user 消息气泡内编辑器(edit-and-resend):替换 MessageBubble 原地编辑,Enter 保存 / Esc 取消 / Shift+Enter 换行。
 * 纯 props 原子组件(草稿为本地态,不进 ctx);自带浅底不透明背景 —— user 气泡是主色深底,编辑器不能透色。
 */
import { nextTick, onMounted, ref } from 'vue'
import { MESSAGES_ZH_CN, type DialogMessages } from '../messages'

const props = withDefaults(defineProps<{
  /** 预填文本(纯图消息的 IMAGE_ONLY_PLACEHOLDER 由父级转空串传入) */
  initialValue: string
  /** 原消息是否带图(纯图消息允许空文本保存) */
  hasImages?: boolean
  /** 生成中(编辑提交触发的重跑进行时;禁保存防双击双发) */
  loading?: boolean
  /** 文案集(容器/父级下传;独立复用缺省中文) */
  messages?: DialogMessages
}>(), { hasImages: false, loading: false, messages: () => ({ ...MESSAGES_ZH_CN }) })
const emit = defineEmits<{ (e: 'save', text: string): void; (e: 'cancel'): void }>()

const draft = ref(props.initialValue)
const ta = ref<HTMLTextAreaElement | null>(null)

/** 自适应高度:内容撑高(高度上限交给 CSS max-height,超出滚动) */
function autoResize() {
  const el = ta.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

onMounted(async () => {
  await nextTick()
  const el = ta.value
  if (!el) return
  autoResize()
  el.focus()
  // 光标置尾:预填历史消息,编辑动作多发生在末尾追加/改写
  el.setSelectionRange(el.value.length, el.value.length)
})

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.preventDefault(); emit('cancel'); return }
  // IME 合成期回车(确认候选词)不保存(isComposing / keyCode 229);与 ChatInput 发送守卫同款
  if (e.isComposing || e.keyCode === 229) return
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); trySave() }
}

function trySave() {
  if (props.loading) return
  if (!draft.value.trim() && !props.hasImages) return
  emit('save', draft.value)
}
</script>

<template>
  <div class="msg-edit" data-test="msg-edit">
    <textarea
      ref="ta"
      v-model="draft"
      class="msg-edit-area"
      data-test="msg-edit-area"
      :disabled="loading"
      @keydown="onKeydown"
      @input="autoResize"
    ></textarea>
    <div class="msg-edit-actions">
      <button type="button" class="msg-edit-btn primary" data-test="msg-edit-save" :disabled="loading || !(draft.trim() || hasImages)" @click="trySave">{{ messages.editSave }}</button>
      <button type="button" class="msg-edit-btn" data-test="msg-edit-cancel" :disabled="loading" @click="$emit('cancel')">{{ messages.editCancel }}</button>
    </div>
  </div>
</template>

<style scoped>
/* 编辑器容器:浅底卡片(独立于 user 气泡的深底配色);聚焦主色描边与 ChatInput 输入区同观感 */
.msg-edit {
  display: flex; flex-direction: column; gap: 6px;
  width: 100%; border-radius: 8px;
  background: var(--cs-input-bg, var(--cs-step-bg, #fff));
  color: var(--cs-bg-text, inherit);
  border: 1px solid var(--cs-input-border, rgba(var(--cs-primary-rgb, 31, 77, 58), 0.2));
  box-shadow: 0 0 0 2px rgba(var(--cs-primary-rgb, 31, 77, 58), 0.1);
  padding: 6px;
}
.msg-edit-area {
  display: block; width: 100%; border: none; outline: none; background: transparent; resize: none;
  padding: 6px 8px; font-size: 13px; font-family: inherit; line-height: 1.5; color: var(--cs-bg-text, inherit);
  min-height: 38px; max-height: 50vh; overflow-y: auto;
  overflow-wrap: anywhere; word-break: break-word; white-space: pre-wrap;
}
.msg-edit-area:disabled { opacity: 0.55; cursor: not-allowed; }
.msg-edit-actions { display: flex; gap: 6px; justify-content: flex-end; }
.msg-edit-btn {
  padding: 3px 10px; border-radius: 6px; font-size: 11px; line-height: 1.6; cursor: pointer;
  border: 1px solid var(--cs-step-border, #e2e6ea); background: var(--cs-step-bg, #f4f6f8); color: var(--cs-bg-text, #6b7280);
  transition: all 0.2s;
}
.msg-edit-btn:hover:not(:disabled) { border-color: var(--cs-primary); color: var(--cs-primary); }
.msg-edit-btn.primary { background: var(--cs-primary, #1f4d3a); border-color: var(--cs-primary, #1f4d3a); color: #fff; }
.msg-edit-btn.primary:hover:not(:disabled) { color: #fff; opacity: 0.9; }
.msg-edit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
