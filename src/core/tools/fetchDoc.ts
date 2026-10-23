/**
 * GET 文档工具 —— 浏览器内抓取文档
 *
 * 现实约束:浏览器 fetch 仅能获取同源或服务端已配置 CORS 的资源,
 * 跨域会被拦截;跨域抓取需后端代理(本期不提供)。
 * 大结果(超 offload 阈值)由 createAgent 的 coreExecTool 统一外存 vfs,
 * 可 vfs_read 分页回读 / vfs_grep 局部检索,本工具不再自行截断(避免丢信息)。
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { CONTENT_TELEMETRY_MARK, reportSuspicion, scanInjectionHints, wrapUntrustedContent, type ContentTelemetryDeps } from './untrustedContent'

/** fetch 超时(ms):防止慢响应/挂起的服务阻塞 agent 循环 */
const FETCH_TIMEOUT_MS = 30000

/** fetch_document 注入遥测订阅集(挂工具对象,SDK 装配层经 wireContentTelemetry 接计数留痕) */
const fetchTelemetry: ContentTelemetryDeps = { subscribers: [] }

export const fetchDocumentTool = tool(
  async ({ url, as }) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(url, { method: 'GET', signal: controller.signal })
      if (!res.ok) {
        return `请求失败:HTTP ${res.status} ${res.statusText}(${url})`
      }
      const text = await res.text()
      const fmt = as === 'markdown' ? 'markdown' : 'text'
      // 不截断:大结果交由 createAgent 的 offload 外存 vfs(可分页回读 / 局部检索)
      // 不可信内容标记:抓取的网页可能含试图操纵 agent 的指令(prompt injection),用明确分隔围起
      // (围栏单源 untrustedContent.ts,RAG untrusted 通道同款);注入遥测在回执组装点扫描(只留痕不阻断)
      reportSuspicion(fetchTelemetry, 'fetch_document', scanInjectionHints(text))
      return [`文档内容(${url},${fmt}):`, wrapUntrustedContent(text)].join('\n')
    } catch (e) {
      const msg = (e as Error)?.message || String(e)
      if (controller.signal.aborted) {
        return `获取失败:请求超时(${FETCH_TIMEOUT_MS}ms,${url})。`
      }
      // 浏览器跨域/网络错误通常表现为 "Failed to fetch" / "NetworkError"
      if (/Failed to fetch|NetworkError|CORS|blocked/i.test(msg)) {
        return `获取失败:可能是 CORS 跨域拦截或网络错误(${msg})。浏览器仅能 GET 同源或服务端已配置 CORS 的资源;跨域抓取需后端代理。`
      }
      return `获取失败:${msg}`
    } finally {
      clearTimeout(timer)
    }
  },
  {
    name: 'fetch_document',
    description:
      '以 GET 请求抓取文档/网页/接口文本。仅支持同源或已配置 CORS 的 URL;跨域会被浏览器拦截。大结果自动外存到虚拟工作区,可用 vfs_read / vfs_grep 回读。',
    schema: z.object({
      url: z.string().describe('要抓取的 URL(同源或已配 CORS)'),
      as: z.enum(['text', 'markdown']).optional().describe('返回格式标签,默认 text'),
    }),
  },
)

// 注入遥测订阅挂点(单例工具):装配层 wireContentTelemetry(fetchDocTools, cb) 订阅;
// 订阅制非覆盖,多 sdk 实例共存时各自计数互不吞并
;(fetchDocumentTool as any)[CONTENT_TELEMETRY_MARK] = fetchTelemetry

export const fetchDocTools = [fetchDocumentTool]
