// test/mcp.test.mjs — stdio MCP server 协议级单测：initialize 握手、tools/list
// schema、tools/call 返回、错误响应、只读打开（库缺失空结果、不 bump recall）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { openMemoryStore } from '../lib/store.mjs'
import { SubstringRetriever } from '../lib/retrieval.mjs'
import {
  createMcpServer,
  ReadOnlyMemoryStore,
  runStdioServer,
  MCP_SERVER_NAME,
  MCP_PROTOCOL_VERSION,
} from '../lib/mcp.mjs'

/** 建临时库并写入若干记忆，返回临时目录（关闭清理交给调用方单一 t.after）。 */
function seedDb() {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-memento-mcp-'))
  const dbPath = path.join(dir, 'memory.db')
  const store = openMemoryStore(dbPath)
  store.insertEntry({ track: 'user', scope: 'workspace', text: '用户偏好：回复用中文', source: 'claude' })
  store.insertEntry({ track: 'agent', scope: 'user-global', text: '项目约定：测试先于实现', source: 'memory-tool' })
  store.insertEntry({ track: 'agent', scope: 'workspace', text: '环境事实：Node 22', source: 'memory-tool' })
  store.close()
  return dir
}

/** 打开只读 store 并组装 server（同一 after 关闭只读连接再删临时目录）。 */
function setup(t) {
  const dir = seedDb()
  const store = new ReadOnlyMemoryStore(path.join(dir, 'memory.db'))
  const server = createMcpServer({ store, retriever: new SubstringRetriever(), version: '0.4.5' })
  t.after(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return { server, store }
}

/** 取 JSON-RPC 响应的 result 字段（断言无 error）。 */
function resultOf(response) {
  assert.equal(response.error, undefined, `expected no error, got ${JSON.stringify(response.error)}`)
  return response.result
}

test('initialize 握手：返回协议版本、capabilities.tools 与 serverInfo', (t) => {
  const { server } = setup(t)
  const response = server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: MCP_PROTOCOL_VERSION } })
  assert.equal(response.id, 1)
  assert.equal(response.jsonrpc, '2.0')
  const result = resultOf(response)
  assert.equal(result.protocolVersion, MCP_PROTOCOL_VERSION)
  assert.deepEqual(result.capabilities, { tools: {} })
  assert.equal(result.serverInfo.name, MCP_SERVER_NAME)
  assert.equal(result.serverInfo.version, '0.4.5')
})

test('notifications/initialized：通知不回写；ping 回空结果', (t) => {
  const { server } = setup(t)
  assert.equal(server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null)
  assert.deepEqual(server.handle({ jsonrpc: '2.0', id: 2, method: 'ping' }), { jsonrpc: '2.0', id: 2, result: {} })
})

test('tools/list：暴露 memory_search 与 memory_stats 的 schema', (t) => {
  const { server } = setup(t)
  const result = resultOf(server.handle({ jsonrpc: '2.0', id: 3, method: 'tools/list' }))
  const names = result.tools.map((tool) => tool.name).sort()
  assert.deepEqual(names, ['memory_search', 'memory_stats'])
  const search = result.tools.find((tool) => tool.name === 'memory_search')
  assert.equal(search.inputSchema.type, 'object')
  assert.deepEqual(search.inputSchema.required, ['query'])
  assert.equal(typeof search.inputSchema.properties.query.type, 'string')
  const stats = result.tools.find((tool) => tool.name === 'memory_stats')
  assert.equal(stats.inputSchema.type, 'object')
})

test('tools/call memory_search：按 query 返回命中条目（大小写不敏感）', (t) => {
  const { server } = setup(t)
  const response = server.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'memory_search', arguments: { query: '中文' } } })
  const result = resultOf(response)
  assert.equal(result.isError, undefined)
  const text = JSON.parse(result.content[0].text)
  assert.equal(text.total, 1)
  assert.equal(text.truncated, false)
  assert.equal(text.entries.length, 1)
  assert.equal(text.entries[0].text, '用户偏好：回复用中文')
  assert.equal(text.entries[0].track, 'user')
  assert.deepEqual(text.entries[0].tags, [])
})

test('tools/call memory_search：不命中返回空结果；limit 截断标记', (t) => {
  const { server } = setup(t)
  const miss = resultOf(server.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'memory_search', arguments: { query: '不存在' } } }))
  const missText = JSON.parse(miss.content[0].text)
  assert.equal(missText.total, 0)
  assert.deepEqual(missText.entries, [])
  // "：" 命中三条，limit 1 应截断。
  const capped = resultOf(server.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'memory_search', arguments: { query: '：', limit: 1 } } }))
  const cappedText = JSON.parse(capped.content[0].text)
  assert.equal(cappedText.entries.length, 1)
  assert.equal(cappedText.truncated, true)
})

test('tools/call memory_stats：条目总数与命名空间概览', (t) => {
  const { server } = setup(t)
  const result = resultOf(server.handle({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'memory_stats', arguments: {} } }))
  const stats = JSON.parse(result.content[0].text)
  assert.equal(stats.total, 3)
  assert.deepEqual(stats.namespaces, [
    { track: 'agent', scope: 'user-global', count: 1 },
    { track: 'agent', scope: 'workspace', count: 1 },
    { track: 'user', scope: 'workspace', count: 1 },
  ])
})

test('错误响应：未知方法 -32601、非法 params -32602、未知工具 isError', (t) => {
  const { server } = setup(t)
  const unknown = server.handle({ jsonrpc: '2.0', id: 8, method: 'nope' })
  assert.equal(unknown.error.code, -32601)
  const badParams = server.handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { arguments: {} } })
  assert.equal(badParams.error.code, -32602)
  const badArgs = server.handle({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'memory_search', arguments: {} } })
  assert.equal(badArgs.result.isError, true)
  const unknownTool = server.handle({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'nope_tool', arguments: {} } })
  assert.equal(unknownTool.result.isError, true)
})

test('只读打开：库不存在返回空结果而非崩溃，也不 bump recall_count', (t) => {
  const missing = new ReadOnlyMemoryStore(path.join(tmpdir(), 'definitely-not-a-memento-db.db'))
  t.after(() => missing.close())
  assert.equal(missing.present, false)
  assert.equal(missing.available, false)
  const server = createMcpServer({ store: missing, retriever: new SubstringRetriever() })
  const search = resultOf(server.handle({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'memory_search', arguments: { query: 'x' } } }))
  assert.deepEqual(JSON.parse(search.content[0].text), { total: 0, entries: [], truncated: false })
  const stats = resultOf(server.handle({ jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'memory_stats', arguments: {} } }))
  assert.deepEqual(JSON.parse(stats.content[0].text), { total: 0, namespaces: [] })
})

test('只读打开：空文件（无 entries 表）按空库处理', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-memento-mcp-empty-'))
  const dbPath = path.join(dir, 'empty.db')
  writeFileSync(dbPath, '')
  const store = new ReadOnlyMemoryStore(dbPath)
  t.after(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })
  assert.equal(store.available, true)
  const server = createMcpServer({ store, retriever: new SubstringRetriever() })
  const search = resultOf(server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memory_search', arguments: { query: 'x' } } }))
  assert.deepEqual(JSON.parse(search.content[0].text), { total: 0, entries: [], truncated: false })
  const stats = resultOf(server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'memory_stats', arguments: {} } }))
  assert.deepEqual(JSON.parse(stats.content[0].text), { total: 0, namespaces: [] })
})

test('只读打开：损坏库返回 isError 结果而非崩溃', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-memento-mcp-corrupt-'))
  const dbPath = path.join(dir, 'memory.db')
  writeFileSync(dbPath, 'this is not a sqlite database file')
  const store = new ReadOnlyMemoryStore(dbPath)
  t.after(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })
  assert.equal(store.present, true)
  const server = createMcpServer({ store, retriever: new SubstringRetriever() })
  const search = server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memory_search', arguments: { query: 'x' } } })
  assert.equal(search.result.isError, true)
  const stats = server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'memory_stats', arguments: {} } })
  assert.equal(stats.result.isError, true)
})

test('runStdioServer：逐行读、逐行写、通知不回写、解析失败回 -32700', async () => {
  const store = new ReadOnlyMemoryStore(path.join(tmpdir(), 'no-such-mcp-db.db'))
  const server = createMcpServer({ store, retriever: new SubstringRetriever() })
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  let received = ''
  stdout.on('data', (chunk) => { received += String(chunk) })
  const dispose = runStdioServer(server, { stdin, stdout })
  stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n')
  stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
  stdin.write('not json\n')
  stdin.end()
  await new Promise((resolve) => { stdin.on('end', () => setImmediate(resolve)) })
  dispose()
  const lines = received.split('\n').filter((line) => line.length > 0)
  assert.equal(lines.length, 2)
  assert.equal(JSON.parse(lines[0]).id, 1)
  assert.equal(JSON.parse(lines[1]).error.code, -32700)
})
