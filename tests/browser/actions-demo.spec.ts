// actions-demo(宿主动作 + 裁决回传):update_preferences(deferredWrite)→ 草稿面板 → 保存/放弃 →
// resolveAction → 下一轮请求带【宿主动作裁决结果】一次性段;sync_preferences_remote 抛错 → 模型收到
// 结构化 ACTION_FAILED toolError(断言落在下一轮请求的 wire 上)
import { test, expect, type Page, type Route } from '@playwright/test'

/** SSE 单 chunk 序列化(OpenAI 兼容) */
const sse = (chunks: Array<Record<string, unknown>>): string =>
  chunks.map((c) => `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', model: 'mock', choices: [{ index: 0, delta: c, finish_reason: null }] })}`).join('\n\n')
    + '\n\ndata: [DONE]\n\n'

const toolCall = (name: string, args: Record<string, unknown>) => sse([{ role: 'assistant', tool_calls: [{ id: `c_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }])
const textDone = (text: string) => sse([{ role: 'assistant' }, { content: text }, { finish_reason: 'stop' }])

interface MockHandle { bodies: string[] }

/** 三步脚本(非标题请求按序计数;标题请求先行放行不计数,保持步数确定) */
async function mockActionFlow(page: Page, steps: Array<(bodies: string[]) => string>): Promise<MockHandle> {
  const handle: MockHandle = { bodies: [] }
  let calls = 0
  await page.route('**/chat/completions**', async (route: Route) => {
    const body = route.request().postData() || ''
    if (body.includes('生成一个简短的中文标题')) return route.fulfill({ status: 200, contentType: 'text/event-stream', body: textDone('测试标题') })
    const respond = steps[Math.min(calls, steps.length - 1)] ?? (() => textDone('好的。'))
    calls += 1
    handle.bodies.push(body)
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: respond(handle.bodies) })
  })
  return handle
}

test.describe('actions-demo:宿主动作与裁决回传', () => {
  test('保存全链:toolCall → 草稿面板 → 保存写回 + resolveAction → 下轮请求带采纳(已生效)段', async ({ page }) => {
    await page.goto('/examples/actions-demo/')
    await page.waitForSelector('.chat-dialog', { state: 'attached' })
    const handle = await mockActionFlow(page, [
      () => toolCall('update_preferences', { instruction: '主题:深色' }),
      () => textDone('草稿已在页面面板打开,等你确认。'),
      () => textDone('已保存,当前主题是深色。'),
    ])
    await page.evaluate((msg) => (window as unknown as { __sdk: { send: (m: string) => Promise<unknown> } }).__sdk.send(msg), '帮我把主题改成深色')
    await page.waitForSelector('[data-test="draft-panel"]', { timeout: 15000 })

    // 草稿面板:instruction 逐字送达(宿主可手改,保存取面板终值)
    await expect(page.locator('[data-test="draft-text"]')).toHaveValue('主题:深色')

    // 保存:写回 textarea + resolveAction('applied') → 事件流水 + 面板收起
    await page.click('[data-test="save-btn"]')
    await expect(page.locator('[data-test="source"]')).toHaveValue(/主题:深色\s*$/)
    await expect(page.locator('[data-test="draft-panel"]')).toHaveCount(0)
    await expect(page.locator('[data-test="events"]')).toContainText('update_preferences → applied')

    // 下一轮:请求 wire 上必须带一次性结局段(模型不再凭「草稿等确认」的旧回执作答)
    await page.evaluate((msg) => (window as unknown as { __sdk: { send: (m: string) => Promise<unknown> } }).__sdk.send(msg), '刚才的偏好保存成功了吗?')
    const last = handle.bodies[handle.bodies.length - 1]
    expect(last).toContain('【宿主动作裁决结果】')
    expect(last).toContain('update_preferences 的结果已被用户采纳(已生效):已写入偏好清单')
  })

  test('放弃分支:偏好清单原样 + 下轮请求带放弃(未生效)段', async ({ page }) => {
    await page.goto('/examples/actions-demo/')
    await page.waitForSelector('.chat-dialog', { state: 'attached' })
    const handle = await mockActionFlow(page, [
      () => toolCall('update_preferences', { instruction: '密度:紧凑' }),
      () => textDone('草稿已在页面面板打开,等你确认。'),
      () => textDone('好的,那条没有保存,偏好清单未变。'),
    ])
    await page.evaluate((msg) => (window as unknown as { __sdk: { send: (m: string) => Promise<unknown> } }).__sdk.send(msg), '密度改成紧凑')
    await page.waitForSelector('[data-test="draft-panel"]', { timeout: 15000 })

    await page.click('[data-test="discard-btn"]')
    await expect(page.locator('[data-test="source"]')).toHaveValue(/^主题:自动/)   // 清单原样
    await expect(page.locator('[data-test="draft-panel"]')).toHaveCount(0)
    await expect(page.locator('[data-test="events"]')).toContainText('update_preferences → discarded')

    await page.evaluate((msg) => (window as unknown as { __sdk: { send: (m: string) => Promise<unknown> } }).__sdk.send(msg), '刚才那条保存了吗?')
    const last = handle.bodies[handle.bodies.length - 1]
    expect(last).toContain('【宿主动作裁决结果】')
    expect(last).toContain('update_preferences 的结果已被用户放弃(未生效)')
  })

  test('run 抛错 → 模型收到结构化 ACTION_FAILED(下一轮请求 wire 可见),偏好清单不动', async ({ page }) => {
    await page.goto('/examples/actions-demo/')
    await page.waitForSelector('.chat-dialog', { state: 'attached' })
    const handle = await mockActionFlow(page, [
      () => toolCall('sync_preferences_remote', {}),
      () => textDone('同步失败:云端服务当前不可用,已如实告知。'),
    ])
    await page.evaluate((msg) => (window as unknown as { __sdk: { send: (m: string) => Promise<unknown> } }).__sdk.send(msg), '把我的偏好同步到云端')

    // 失败回执是结构化 toolError(code + hint),随工具结果进下一轮请求 —— 不是裸中文字符串
    const last = handle.bodies[handle.bodies.length - 1]
    expect(last).toContain('ACTION_FAILED')
    expect(last).toContain('云端服务连接失败')
    // 宿主零写入:失败动作连草稿面板都不开
    await expect(page.locator('[data-test="draft-panel"]')).toHaveCount(0)
    await expect(page.locator('[data-test="source"]')).toHaveValue(/^主题:自动/)
  })
})
