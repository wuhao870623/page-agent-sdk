import { test, expect, type Page } from '@playwright/test'
import { mockLlm, fillInput, clickSend, waitForAgentIdle, clearChat } from './_helpers'

/** 编辑重跑轮的 idle 等待:等新 assistant 回复文本出现 + stop-btn 消失。
 *  不用 waitForAgentIdle:编辑截断使 assistant 数减少,其「assistant 新增」baseline 语义不适用 */
async function waitEditRound(page: Page, replyText: string): Promise<void> {
  await expect(page.locator('.chat-dialog .message-row.assistant').last()).toContainText(replyText, { timeout: 30_000 })
  await page.waitForFunction(() => {
    const btn = document.querySelector('.chat-dialog button.send-btn')
    return !btn || !btn.classList.contains('stop-btn')
  }, undefined, { timeout: 30_000 })
}

/**
 * 编辑已发送 user 消息并重跑(edit-and-resend)浏览器 E2E:
 * - hover user 消息出现编辑按钮 → 气泡内改文 → 保存并重发(截断其后,从编辑点重跑)
 * - Enter 提交 / Esc 取消;两条消息编辑互斥(点 B 弃 A)
 * - 生成中点编辑 = 自动停止(stop-btn 消失)再编辑
 * - 附带字段保留:聚焦发送的消息编辑重发后 focus chip 仍在
 */
test.describe('edit-resend: 编辑已发送消息重跑', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.chat-dialog')
    await clearChat(page)
  })

  // hover 某条 user 消息行点编辑按钮(返回该行内编辑器 textarea)
  async function openEditor(page: Page, idx: number) {
    const row = page.locator(`.chat-dialog .message-row.user[data-msg-idx="${idx}"]`)
    await row.hover()
    await row.locator('[data-test="msg-edit-btn"]').click()
    const area = row.locator('[data-test="msg-edit-area"]')
    await expect(area).toBeVisible()
    return area
  }

  test('hover 编辑 → 改文保存 → 截断其后从编辑点重跑', async ({ page }) => {
    const { calls } = await mockLlm(page, [
      { text: '第一轮回复' },
      { text: '第二轮回复' },
      { text: '编辑重跑回复' },
    ])
    // 两轮对话
    await fillInput(page, '第一版输入')
    await clickSend(page)
    await waitForAgentIdle(page)
    await fillInput(page, '第二版输入')
    await clickSend(page)
    await waitForAgentIdle(page)
    await expect.poll(() => calls()).toBe(2)

    // 编辑第 1 条 user(index 0)
    const area = await openEditor(page, 0)
    await expect(area).toHaveValue('第一版输入')
    await area.fill('修改后的输入')
    await page.locator('[data-test="msg-edit-save"]').click()

    // 截断:第二轮 user/assistant 消失;重跑:新回复出现
    await waitEditRound(page, '编辑重跑回复')
    const dialogText = (await page.textContent('.chat-dialog')) || ''
    expect(dialogText).toContain('修改后的输入')
    expect(dialogText).not.toContain('第二版输入')
    expect(dialogText).not.toContain('第二轮回复')
  })

  test('Enter 提交编辑(与输入框一致)/ Esc 取消不动历史', async ({ page }) => {
    await mockLlm(page, [
      { text: '回复一' },
      { text: 'Enter 重跑回复' },
    ])
    await fillInput(page, '原始输入')
    await clickSend(page)
    await waitForAgentIdle(page)

    // Esc 取消:编辑器关闭,历史原样,不再消耗 mock
    const area = await openEditor(page, 0)
    await area.fill('取消不落地的文本')
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-test="msg-edit-area"]')).toHaveCount(0)
    expect(((await page.textContent('.chat-dialog')) || '')).toContain('原始输入')

    // Enter 提交:重跑发生
    const area2 = await openEditor(page, 0)
    await area2.fill('Enter 版输入')
    await area2.press('Enter')
    await waitEditRound(page, 'Enter 重跑回复')
    const dialogText = (await page.textContent('.chat-dialog')) || ''
    expect(dialogText).toContain('Enter 版输入')
  })

  test('编辑互斥:一条编辑中点另一条,前者自动退出', async ({ page }) => {
    await mockLlm(page, [
      { text: '回复一' },
      { text: '回复二' },
    ])
    await fillInput(page, '消息甲')
    await clickSend(page)
    await waitForAgentIdle(page)
    await fillInput(page, '消息乙')
    await clickSend(page)
    await waitForAgentIdle(page)

    await openEditor(page, 0)
    await expect(page.locator('[data-test="msg-edit-area"]')).toHaveCount(1)
    // 点第 2 条的编辑 → 第 1 条退出(单编辑互斥)
    await openEditor(page, 2)
    const rows = page.locator('.chat-dialog .message-row')
    await expect(rows.nth(0).locator('[data-test="msg-edit-area"]')).toHaveCount(0)
    await expect(rows.nth(2).locator('[data-test="msg-edit-area"]')).toHaveCount(1)
  })

  test('生成中点编辑 = 自动停止再编辑(停止后修改重跑)', async ({ page }) => {
    // 第一轮延迟 2000ms 制造 loading 窗口(queue.spec 同款)
    await mockLlm(page, [
      { text: '被截断不该出现的回复' },
      { text: '编辑后回复' },
    ], [2000, 0])

    await fillInput(page, '生成中输入')
    await clickSend(page)
    await page.waitForSelector('.chat-dialog .stop-btn', { timeout: 10_000 })

    // loading 中点编辑 → 自动 stop(stop-btn 消失)+ 编辑器出现
    const area = await openEditor(page, 0)
    await expect(page.locator('.chat-dialog .stop-btn')).toHaveCount(0, { timeout: 10_000 })
    await area.fill('停止后修改的输入')
    await page.locator('[data-test="msg-edit-save"]').click()
    await waitForAgentIdle(page)

    const dialogText = (await page.textContent('.chat-dialog')) || ''
    expect(dialogText).toContain('停止后修改的输入')
    expect(dialogText).toContain('编辑后回复')
    expect(dialogText).not.toContain('生成中输入')
  })

  test('附带字段保留:聚焦发送的消息编辑重发后 focus chip 仍在', async ({ page }) => {
    await mockLlm(page, [
      { text: '聚焦回复' },
      { text: '编辑重跑回复' },
    ])
    // 拖画布组件入输入框 → 聚焦 chip(quick-actions.spec 同款路径)
    await page.evaluate(`(() => {
      const src = document.querySelector('[data-path]')
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true }))
      document.querySelector('.chat-dialog .chat-input-wrap').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
    })()`)
    await expect(page.locator('.chat-dialog .focus-chip', { hasText: 'components.0' })).toBeVisible({ timeout: 5_000 })

    await fillInput(page, '带焦点的输入')
    await clickSend(page)
    await waitForAgentIdle(page)

    const row = page.locator('.chat-dialog .message-row.user[data-msg-idx="0"]')
    await expect(row.locator('.msg-focus-chip')).toHaveCount(1)

    // 编辑重发 → 焦点快照随消息保留
    const area = await openEditor(page, 0)
    await area.fill('改写后仍带焦点')
    await page.locator('[data-test="msg-edit-save"]').click()
    await waitEditRound(page, '编辑重跑回复')
    const newRow = page.locator('.chat-dialog .message-row.user[data-msg-idx="0"]')
    await expect(newRow.locator('.msg-focus-chip')).toHaveCount(1)
  })
})
