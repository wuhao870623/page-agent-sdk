import { test, expect } from '@playwright/test'
import { mockLlm, fillInput, clickSend, clickByText, waitForAgentIdle, clearChat } from './_helpers'

/**
 * human-confirm-demo 浏览器 E2E:两层 human-in-the-loop
 *
 * 验证 refactor 后 conflictManager + humanConfirm + approval 中间件正常:
 * - 第一层:LLM 主动征询(request_human_confirmation)→ 选项按钮出现
 * - 用户选方案 → LLM 落地 write → 第二层写前确认(允许/拒绝)
 * - 用户点「允许」→ write 执行 → 页面 appConfig 更新
 * - gate-pending 死局修:确认条挂起期输入禁发(挂起消息永不消费的死局消除),停止按钮逃生口不受影响
 */
test.describe('human-confirm-demo: 两层确认', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/human-confirm-demo/')
    await page.waitForSelector('.chat-dialog')
    await clearChat(page)
  })

  test('主动征询 → 选方案 → 写前确认 → 允许 → 页面更新', async ({ page }) => {
    await mockLlm(page, [
      // 第一层:LLM 主动征询,弹选项按钮
      { tool_calls: [{ name: 'request_human_confirmation', arguments: {
        question: '给你两个方案:',
        options: ['暗夜紫+紧凑+6px', '暖橙+宽松+24px'],
        recommendation: '推荐暗夜紫',
      } }] },
      // 第二层:用户选了方案 A,LLM 落地 write(触发写前确认)
      { tool_calls: [{ name: 'write', arguments: {
        value: { theme: 'night-purple', density: 'compact', radius: 6 },
      } }] },
      // 第三层:write 完成,LLM 回复
      { text: '已完成,界面已切换为暗夜紫风格。' },
    ])

    await fillInput(page, '换个感觉,给几个方案我挑')
    await clickSend(page)

    // === 第一层:等待选项按钮出现 ===
    await page.waitForSelector('button:has-text("暗夜紫")', { timeout: 15_000 })

    // 断言:选项按钮存在
    const optionBtn = page.locator('button', { hasText: '暗夜紫+紧凑+6px' })
    await expect(optionBtn).toBeVisible()

    // 点击方案 A
    await clickByText(page, '暗夜紫+紧凑+6px')

    // === 第二层:等待写前确认出现(允许/拒绝) ===
    await page.waitForSelector('button:has-text("允许")', { timeout: 15_000 })

    // 断言:允许按钮存在
    await expect(page.locator('button', { hasText: '允许' })).toBeVisible()

    // 点击允许
    await clickByText(page, '允许')

    // 等待 agent 完成
    await waitForAgentIdle(page)

    // 断言:window.appConfig 已更新
    const config = await page.evaluate(() => {
      const c = (window as any).appConfig
      return { theme: c.theme, density: c.density, radius: c.radius }
    })
    expect(config.theme).toBe('night-purple')
    expect(config.density).toBe('compact')
    expect(config.radius).toBe(6)

    // 断言:页面 DOM 已更新(theme code 文本)
    const themeCode = await page.textContent('.cfg code:has-text("night-purple")')
    expect(themeCode).toContain('night-purple')
  })

  test('主动征询 → 选方案 → 写前确认 → 拒绝 → write 不执行', async ({ page }) => {
    await mockLlm(page, [
      { tool_calls: [{ name: 'request_human_confirmation', arguments: {
        question: '给你两个方案:',
        options: ['方案A', '方案B'],
      } }] },
      { tool_calls: [{ name: 'write', arguments: {
        value: { theme: 'warm-orange', density: 'spacious', radius: 24 },
      } }] },
      { text: '好的,已取消修改。' },
    ])

    await fillInput(page, '换个风格')
    await clickSend(page)

    // 第一层:选方案 A
    await page.waitForSelector('button:has-text("方案A")', { timeout: 15_000 })
    await clickByText(page, '方案A')

    // 第二层:等写前确认,点拒绝
    await page.waitForSelector('button:has-text("拒绝")', { timeout: 15_000 })
    await clickByText(page, '拒绝')

    await waitForAgentIdle(page)

    // 断言:appConfig 未变(还是初始值)
    const config = await page.evaluate(() => {
      const c = (window as any).appConfig
      return { theme: c.theme, density: c.density, radius: c.radius }
    })
    expect(config.theme).toBe('fresh-blue')
    expect(config.density).toBe('cozy')
    expect(config.radius).toBe(12)
  })

  test('gate-pending 死局修:确认条挂起期输入禁发 + 提示,两层门禁连续覆盖,解除后恢复', async ({ page }) => {
    await mockLlm(page, [
      { tool_calls: [{ name: 'request_human_confirmation', arguments: {
        question: '给你两个方案:',
        options: ['方案A', '方案B'],
      } }] },
      { tool_calls: [{ name: 'write', arguments: { value: { theme: 'warm-orange', density: 'spacious', radius: 24 } } }] },
      { text: '已完成。' },
    ])
    await fillInput(page, '换个风格')
    await clickSend(page)

    // === 第一层挂起:输入区禁发(textarea disabled + gate-hint 可见),停止按钮不受影响(逃生口)===
    await page.waitForSelector('button:has-text("方案A")', { timeout: 15_000 })
    await expect(page.locator('.chat-input')).toBeDisabled()
    await expect(page.locator('[data-test="gate-hint"]')).toBeVisible()
    await expect(page.locator('button.send-btn')).toBeEnabled()  // loading 中 = 停止态,可点

    // 解除第一层 → 第二层写前确认立即挂起:输入保持禁发(连续门禁覆盖,无缝隙窗口)
    await clickByText(page, '方案A')
    await page.waitForSelector('button:has-text("允许")', { timeout: 15_000 })
    await expect(page.locator('.chat-input')).toBeDisabled()

    // 解除第二层 → 流收口:输入恢复,提示行消失
    await clickByText(page, '允许')
    await waitForAgentIdle(page)
    await expect(page.locator('.chat-input')).toBeEnabled()
    await expect(page.locator('[data-test="gate-hint"]')).toBeHidden()
  })

  test('gate-pending 逃生口:挂起期点停止 → 流中止,输入恢复不锁死', async ({ page }) => {
    await mockLlm(page, [
      { tool_calls: [{ name: 'request_human_confirmation', arguments: {
        question: '给你两个方案:',
        options: ['方案A'],
      } }] },
    ])
    await fillInput(page, '换个风格')
    await clickSend(page)

    // 挂起期:输入禁用,但停止按钮(stop 态)可点 —— 用户不想处理确认条时的逃生口
    await page.waitForSelector('button:has-text("方案A")', { timeout: 15_000 })
    await expect(page.locator('.chat-input')).toBeDisabled()

    await page.click('button.send-btn.stop-btn')
    await waitForAgentIdle(page)
    // abort 收口(finally 清 pendingApproval)→ 门禁解除,输入恢复
    await expect(page.locator('.chat-input')).toBeEnabled()
    await expect(page.locator('[data-test="gate-hint"]')).toBeHidden()
  })
})

test.describe('human-confirm-demo: write 审批 diff 预览(ui-quick-wins Q3,?preview=1)', () => {
  test('write 挂起时 ApprovalBar 渲染结构化 old→new', async ({ page }) => {
    await page.goto('/examples/human-confirm-demo/?preview=1')
    await page.waitForSelector('.chat-dialog')
    await clearChat(page)
    await mockLlm(page, [
      { tool_calls: [{ name: 'write', arguments: { value: { theme: 'night-purple', density: 'compact', radius: 6 } } }] },
      { text: '(预览态点拒绝收口)' },
    ])
    await fillInput(page, '直接切换风格')
    await clickSend(page)
    // 写前确认条出现 + 结构化预览(set 逐变更键 old→new)
    await page.waitForSelector('[data-test="approval-preview"]', { timeout: 15_000 })
    const item = page.locator('[data-test="preview-item-0"]')
    await expect(item).toBeVisible()
    await expect(item.locator('.preview-path')).toHaveText('theme')
    await expect(item.locator('.preview-old')).toContainText('fresh-blue')
    await expect(item.locator('.preview-new')).toContainText('night-purple')
    // 预览是纯展示:点拒绝 → 工具被拒收口,数据未变
    await clickByText(page, '拒绝')
    await waitForAgentIdle(page)
    const theme = await page.evaluate(() => (window as any).appConfig.theme)
    expect(theme).toBe('fresh-blue')
  })

  test('预览 refuse 态(?preview=fail):⚠ 可见 + 「允许」禁用(4.25.1,批准必失败操作无意义)', async ({ page }) => {
    await page.goto('/examples/human-confirm-demo/?preview=fail')
    await page.waitForSelector('.chat-dialog')
    await clearChat(page)
    await mockLlm(page, [
      { tool_calls: [{ name: 'write', arguments: { value: { theme: 'night-purple' } } }] },
      { text: '(refuse 态拒绝后收口)' },
    ])
    await fillInput(page, '直接切换风格')
    await clickSend(page)
    await page.waitForSelector('[data-test="preview-error"]', { timeout: 15_000 })
    await expect(page.locator('[data-test="preview-error"]')).toContainText('预检失败')
    // 核心:refuse 态「允许」禁用,「拒绝」是唯一出口(修前 ⚠ 仅展示仍可盲批 → 批准后必失败白烧一轮)
    await expect(page.locator('[data-test="approval-allow"]')).toBeDisabled()
    await clickByText(page, '拒绝')
    await waitForAgentIdle(page)
    const theme = await page.evaluate(() => (window as any).appConfig.theme)
    expect(theme).toBe('fresh-blue')
  })

  test('默认关(? 无参):确认条无预览区(args JSON 兜底呈现)', async ({ page }) => {    await page.goto('/examples/human-confirm-demo/')
    await page.waitForSelector('.chat-dialog')
    await clearChat(page)
    await mockLlm(page, [
      { tool_calls: [{ name: 'write', arguments: { value: { theme: 'night-purple', density: 'compact', radius: 6 } } }] },
      { text: '(拒绝收口)' },
    ])
    await fillInput(page, '直接切换风格')
    await clickSend(page)
    await page.waitForSelector('button:has-text("拒绝")', { timeout: 15_000 })
    await expect(page.locator('[data-test="approval-preview"]')).toHaveCount(0)
    await clickByText(page, '拒绝')
    await waitForAgentIdle(page)
  })
})

test.describe('human-confirm-demo: 一次性授权(?remember=1,4.26 approval.remember)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/human-confirm-demo/?remember=1')
    await page.waitForSelector('.chat-dialog')
    await clearChat(page)
  })

  test('「允许并不再询问」→ 本次执行 + 会话内第二次 write 免确认直通', async ({ page }) => {
    await mockLlm(page, [
      { tool_calls: [{ name: 'write', arguments: { value: { theme: 'night-purple', density: 'compact', radius: 6 } } }] },
      { text: '第一次完成。' },
      { tool_calls: [{ name: 'write', arguments: { value: { theme: 'warm-orange', density: 'cozy', radius: 12 } } }] },
      { text: '第二次完成(未经确认条)。' },
    ])
    await fillInput(page, '换成暗夜紫')
    await clickSend(page)

    // 确认条出现第三按钮(仅 remember 开);点击 = 允许本次 + 授予会话级免确认
    await page.waitForSelector('[data-test="approval-remember"]', { timeout: 15_000 })
    await expect(page.locator('[data-test="approval-remember"]')).toBeEnabled()
    await page.click('[data-test="approval-remember"]')
    await waitForAgentIdle(page)
    expect(await page.evaluate(() => (window as any).appConfig.theme)).toBe('night-purple')

    // 第二轮:同会话再 write —— 已授权直通,确认条根本不出现,write 直接生效
    await fillInput(page, '再换成暖橙')
    await clickSend(page)
    await waitForAgentIdle(page)
    await expect(page.locator('[data-test="approval-remember"]')).toHaveCount(0)
    await expect(page.locator('[data-test="approval-allow"]')).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).appConfig.theme)).toBe('warm-orange')
  })

  test('默认关(无 ?remember)→ 确认条不出现授权入口', async ({ page }) => {
    await page.goto('/examples/human-confirm-demo/')
    await page.waitForSelector('.chat-dialog')
    await clearChat(page)
    await mockLlm(page, [
      { tool_calls: [{ name: 'write', arguments: { value: { theme: 'night-purple', density: 'compact', radius: 6 } } }] },
      { text: '完成。' },
    ])
    await fillInput(page, '换成暗夜紫')
    await clickSend(page)
    await page.waitForSelector('[data-test="approval-allow"]', { timeout: 15_000 })
    await expect(page.locator('[data-test="approval-remember"]')).toHaveCount(0)
    await page.click('[data-test="approval-allow"]')
    await waitForAgentIdle(page)
  })

  test('refuse 预览态 × remember:授权入口与允许同禁(批准必失败的操作无意义)', async ({ page }) => {
    await page.goto('/examples/human-confirm-demo/?remember=1&preview=fail')
    await page.waitForSelector('.chat-dialog')
    await clearChat(page)
    await mockLlm(page, [
      { tool_calls: [{ name: 'write', arguments: { value: { theme: 'night-purple', density: 'compact', radius: 6 } } }] },
      { text: '被拒后收口。' },
    ])
    await fillInput(page, '换个风格')
    await clickSend(page)
    await page.waitForSelector('[data-test="approval-remember"]', { timeout: 15_000 })
    await expect(page.locator('[data-test="approval-remember"]')).toBeDisabled()
    await expect(page.locator('[data-test="approval-allow"]')).toBeDisabled()
  })
})
