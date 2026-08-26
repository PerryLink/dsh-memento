// lib/mcp.mjs — stdio MCP server export（零 DSH 依赖，仅 node: 内置模块）。
//
// 让外部 MCP 客户端（Claude / Codex 等）以只读方式消费 dsh-memento 记忆库：
// 独立进程入口（bin/mcp-server.mjs）经 stdio 跑 JSON-RPC 2.0 + MCP 协议最小集
// （initialize / tools/list / tools/call / notifications/initialized / ping），
// 传输用 newline-delimited JSON（NDJSON），不支持 Content-Length 帧——文档写明
// 兼容边界（README「MCP server」节）。
//
// 只读为主：连接用 node:sqlite 的 readOnly:true 打开（不跑迁移、不写 WAL、
// 不 bump recall_count）；库文件不存在时返回空结果而非崩溃。检索走既有 retrieval
// Provider seam（默认 SubstringRetriever，即大小写不敏感子串主路径）。

import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { DatabaseSync } from 'node:sqlite'
import { SubstringRetriever } from './retrieval.mjs'
import { MAX_QUERY_LIMIT } from './constants.mjs'

/** MCP 服务器名（initialize 的 serverInfo.name）。 */
export const MCP_SERVER_NAME = 'dsh-memento'

/** 本导出实现的 MCP 协议版本（2025-06-18 是当前常用版本号）。 */
export const MCP_PROTOCOL_VERSION = '2025-06-18'

/** memory_search 默认返回条数上限（显式 limit 可超出，硬钳 MAX_QUERY_LIMIT）。 */
const DEFAULT_LIMIT = 20

/**
 * 只读打开记忆库的封装：可用性（缺失/损坏）+ 检索 + 概览 + 关闭。
 * 缺失文件不视为错误（返回空结果）；打开/查询失败则记录 error，由 MCP 层
 * 转成 isError 工具结果，绝不崩溃进程。
 */
export class ReadOnlyMemoryStore {
  /**
   * @param {string} dbPath - 记忆库绝对路径。
   */
  constructor(dbPath) {
    this.path = dbPath
    /** @type {DatabaseSync | null} */
    this.db = null
    /** @type {string | null} */
    this.error = null
    if (!existsSync(dbPath)) return
    try {
      this.db = new DatabaseSync(dbPath, { readOnly: true })
    } catch (error) {
      this.db = null
      this.error = error instanceof Error ? error.message : String(error)
    }
  }

  /** 库文件是否存在（缺失 = 空结果语义，非错误）。 */
  get present() {
    return existsSync(this.path)
  }

  /** 可用性：文件存在且已成功只读打开。 */
  get available() {
    return this.db !== null
  }

  /** 抛出一个可转成 isError 结果的打开/读取失败。 */
  #fail() {
    if (this.error !== null) {
      throw new Error(`cannot read memory database at ${this.path}: ${this.error}`)
    }
  }

  /** entries 表是否存在（空文件/无表时按空库处理，不抛错）。 */
  #hasEntriesTable() {
    const row = /** @type {{name: string} | undefined} */ (this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'entries'",
    ).get())
    return row !== undefined
  }

  /** 全部条目（SELECT 行 → 公开投影 + 排名字段）。 */
  #rows() {
    this.#fail()
    if (this.db === null || !this.#hasEntriesTable()) return []
    return /** @type {Array<{id: string, track: string, scope: string, text: string, source: string, tags: string, recall_count: number, updated_at: number}>} */ (
      this.db.prepare(
        'SELECT id, track, scope, text, source, tags, recall_count, updated_at FROM entries',
      ).all())
  }

  /**
   * 按 query 检索（大小写不敏感子串，召回频次排序）。走外部传入的检索 Provider
   * （默认 SubstringRetriever）。返回公开条目投影，绝不 bump recall_count。
   * @param {import('./retrieval.mjs').RetrievalProvider} retriever - 检索器。
   * @param {string} query - 检索词。
   * @param {number} [limit] - 返回条数上限（默认 20，硬钳 1000）。
   * @returns {{total: number, entries: Array<{id: string, track: string, scope: string, text: string, source: string, tags: string[]}>, truncated: boolean}}
   */
  search(retriever, query, limit) {
    if (!this.present) return { total: 0, entries: [], truncated: false }
    this.#fail()
    const rows = this.#rows()
    const ranked = retriever.retrieve(query, rows.map((row) => ({
      id: row.id,
      text: row.text,
      recallCount: row.recall_count,
      updatedAt: row.updated_at,
    })))
    const requested = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_LIMIT
    const cap = Math.min(requested, MAX_QUERY_LIMIT)
    const hits = ranked.slice(0, cap)
    const byId = new Map(rows.map((row) => [row.id, row]))
    const entries = hits.map((hit) => {
      const row = /** @type {{id: string, track: string, scope: string, text: string, source: string, tags: string}} */ (byId.get(hit.id))
      return { id: row.id, track: row.track, scope: row.scope, text: row.text, source: row.source, tags: parseTags(row.tags) }
    })
    return { total: ranked.length, entries, truncated: ranked.length > entries.length }
  }

  /**
   * 概览：条目总数 + 按 (track, scope) 分组的命名空间计数。
   * @returns {{total: number, namespaces: Array<{track: string, scope: string, count: number}>}}
   */
  stats() {
    if (!this.present) return { total: 0, namespaces: [] }
    this.#fail()
    if (this.db === null || !this.#hasEntriesTable()) return { total: 0, namespaces: [] }
    const total = /** @type {number} */ (this.db.prepare('SELECT COUNT(*) AS n FROM entries').get().n)
    const namespaces = /** @type {Array<{track: string, scope: string, count: number}>} */ (
      this.db.prepare('SELECT track, scope, COUNT(*) AS count FROM entries GROUP BY track, scope ORDER BY track, scope').all()
    )
    return { total, namespaces }
  }

  /** 关闭只读连接（幂等）。 */
  close() {
    if (this.db === null) return
    try { this.db.close() } catch { /* 已关闭/关闭失败：只读连接，忽略 */ }
    this.db = null
  }
}

/** 解析 tags 列（JSON 数组；只读投影，损坏时宽容回退为空数组）。 */
function parseTags(/** @type {string} */ raw) {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((tag) => typeof tag === 'string') : []
  } catch {
    return []
  }
}

/** memory_search 工具定义（MCP inputSchema）。 */
const MEMORY_SEARCH_TOOL = {
  name: 'memory_search',
  description: 'Search the dsh-memento memory store by case-insensitive substring and return ranked entries (read-only).',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Case-insensitive substring to search for in memory entry text.' },
      limit: { type: 'integer', minimum: 1, description: 'Maximum entries to return (default 20, hard-capped at 1000).' },
    },
    required: ['query'],
  },
}

/** memory_stats 工具定义（MCP inputSchema）。 */
const MEMORY_STATS_TOOL = {
  name: 'memory_stats',
  description: 'Return the memory store overview: total entry count and per-track/scope namespace counts (read-only).',
  inputSchema: { type: 'object', properties: {} },
}

/**
 * 组装 MCP 服务器：持有只读 store、检索器与服务器元数据，暴露 JSON-RPC 分派。
 * @param {{store: ReadOnlyMemoryStore, retriever?: import('./retrieval.mjs').RetrievalProvider, version?: string}} opts - 依赖。
 */
export function createMcpServer(opts) {
  const store = opts.store
  const retriever = opts.retriever ?? new SubstringRetriever()
  const version = opts.version ?? '0.0.0'

  /** @type {Array<{name: string, description: string, inputSchema: object}>} */
  const tools = [MEMORY_SEARCH_TOOL, MEMORY_STATS_TOOL]

  /** 调用一个工具，返回 MCP tools/call 结果形状。 */
  function callTool(/** @type {string} */ name, /** @type {unknown} */ args) {
    switch (name) {
      case 'memory_search': {
        const input = /** @type {{query?: unknown, limit?: unknown}} */ (args ?? {})
        if (typeof input.query !== 'string' || input.query.length === 0) {
          return { content: [{ type: 'text', text: 'invalid arguments: query must be a non-empty string' }], isError: true }
        }
        try {
          const result = store.search(retriever, input.query, Number(input.limit))
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
        } catch (error) {
          return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true }
        }
      }
      case 'memory_stats': {
        try {
          const result = store.stats()
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
        } catch (error) {
          return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true }
        }
      }
      default:
        return { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true }
    }
  }

  /**
   * JSON-RPC 2.0 分派。通知（无 id）返回 null（不写回）；请求返回响应对象。
   * @param {unknown} message - 已解析的 JSON-RPC 消息对象。
   * @returns {object | null} 响应对象（供调用方 JSON.stringify 后写回），通知为 null。
   */
  function handle(/** @type {unknown} */ message) {
    if (message === null || typeof message !== 'object' || Array.isArray(message)) {
      return errorResponse(null, -32600, 'Invalid Request')
    }
    const record = /** @type {Record<string, unknown>} */ (message)
    const hasId = Object.prototype.hasOwnProperty.call(record, 'id')
    const id = hasId ? record.id : undefined
    const method = record.method
    if (typeof method !== 'string') {
      return hasId ? errorResponse(id, -32600, 'Invalid Request') : null
    }
    switch (method) {
      case 'initialize':
        return { jsonrpc: '2.0', id, result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: MCP_SERVER_NAME, version },
        } }
      case 'notifications/initialized':
        // 通知：无 id 不写回；异常带 id 时回空结果（协议宽容）。
        return hasId ? { jsonrpc: '2.0', id, result: {} } : null
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} }
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools } }
      case 'tools/call': {
        const params = /** @type {{name?: unknown, arguments?: unknown}} */ (record.params ?? {})
        if (typeof params.name !== 'string') {
          return errorResponse(id, -32602, 'invalid params: tools/call requires a string "name"')
        }
        const result = callTool(params.name, params.arguments)
        return { jsonrpc: '2.0', id, result }
      }
      default:
        return hasId ? errorResponse(id, -32601, `Method not found: ${method}`) : null
    }
  }

  return { handle, tools, store, retriever, version }
}

/** 构造 JSON-RPC 错误响应。 */
function errorResponse(/** @type {unknown} */ id, /** @type {number} */ code, /** @type {string} */ message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

/**
 * 在 stdio 上跑 NDJSON 传输：逐行读、逐行写，通知不回写、解析失败回 -32700。
 * @param {{handle: (message: unknown) => object | null}} server - createMcpServer 返回值。
 * @param {{stdin?: NodeJS.ReadableStream, stdout?: NodeJS.WritableStream}} [io] - 测试注入用。
 * @returns {() => void} 关闭传输（readline.close）。
 */
export function runStdioServer(server, io = {}) {
  const input = io.stdin ?? process.stdin
  const output = io.stdout ?? process.stdout
  const reader = createInterface({ input, crlfDelay: Infinity })
  reader.on('line', (line) => {
    const trimmed = line.trim()
    if (trimmed === '') return
    let message
    try {
      message = JSON.parse(trimmed)
    } catch {
      output.write(`${JSON.stringify(errorResponse(null, -32700, 'Parse error'))}\n`)
      return
    }
    const response = server.handle(message)
    if (response !== null && response !== undefined) {
      output.write(`${JSON.stringify(response)}\n`)
    }
  })
  return () => reader.close()
}
