// test/retrieval.test.mjs — retrieval Provider seam 单测 + memory_recall 语义召回
// 集成测试：substring 内置检索器、vector 检索器（伪嵌入余弦召回）、注册表、
// 探测降级、以及 Config.retrieval.vector 开关接线的端到端路径。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  rankOrder,
  SubstringRetriever,
  VectorRetriever,
  RetrievalProviderRegistry,
  detectVectorBackend,
} from '../lib/retrieval.mjs'
import { FakeEmbeddingProvider } from '../lib/embedding.mjs'
import { InvalidInputError, RetrievalNotFoundError } from '../lib/errors.mjs'
import { apply, DEFAULT_BUDGETS } from '../index.mjs'
import { createMockCtx, makeSession, makeAgent, makeExec } from './helpers/mock-ctx.mjs'

function entry(id, text, recallCount = 0, updatedAt = 0) {
  return { id, text, recallCount, updatedAt }
}

test('rankOrder：召回频次降序 → 更新时间降序 → id 升序', () => {
  const ordered = [entry('a', '', 0, 0), entry('b', '', 5, 0), entry('c', '', 5, 9), entry('d', '', 5, 9)]
  assert.deepEqual(ordered.sort(rankOrder).map((e) => e.id), ['c', 'd', 'b', 'a'])
})

test('SubstringRetriever：大小写不敏感子串过滤 + 召回频次排序（不截断）', () => {
  const retriever = new SubstringRetriever()
  assert.equal(retriever.id, 'substring')
  assert.equal(retriever.kind, 'substring')
  const entries = [
    entry('a', '用户偏好：回复用中文', 0, 1),
    entry('b', '用户偏好：代码注释用英文', 9, 0),
    entry('c', '项目约定：测试先于实现', 0, 0),
  ]
  const hits = retriever.retrieve('用户偏好', entries)
  assert.deepEqual(hits.map((e) => e.id), ['b', 'a'])
  assert.deepEqual(retriever.retrieve('不存在', entries), [])
  assert.deepEqual(retriever.retrieve('用户偏好', entries).length, 2)
})

test('VectorRetriever：按余弦相似度召回（伪嵌入 token 重叠）', () => {
  const embedding = new FakeEmbeddingProvider()
  const retriever = new VectorRetriever({ embedding })
  assert.equal(retriever.id, 'vector')
  assert.equal(retriever.kind, 'vector')
  const entries = [
    entry('q', 'quantum gravity is hard'),
    entry('l', 'favorite drink is lapsang souchong'),
  ]
  const ranked = retriever.retrieve('tea lapsang', entries)
  assert.deepEqual(ranked.map((e) => e.id), ['l', 'q'])
})

test('VectorRetriever：空候选直接返回空；缺 embedding 响亮失败', () => {
  const embedding = new FakeEmbeddingProvider()
  assert.deepEqual(new VectorRetriever({ embedding }).retrieve('x', []), [])
  assert.throws(() => new VectorRetriever({}), (error) => error instanceof InvalidInputError)
  assert.throws(() => new VectorRetriever({ embedding: null }), (error) => error instanceof InvalidInputError)
})

test('detectVectorBackend：无 embedding 不可用（降级），有 embedding 可用', () => {
  assert.deepEqual(detectVectorBackend(), { available: false, sqliteVec: false, reason: 'no embedding provider available' })
  assert.deepEqual(detectVectorBackend({ embedding: new FakeEmbeddingProvider() }), { available: true, sqliteVec: false })
})

test('RetrievalProviderRegistry：register 可逆 / list 排序 / get / resolve / 冲突', () => {
  const registry = new RetrievalProviderRegistry()
  const substring = new SubstringRetriever()
  const disposer = registry.register(substring)
  assert.deepEqual(registry.list().map((p) => p.id), ['substring'])
  assert.equal(registry.get('substring'), substring)
  assert.equal(registry.resolve('substring'), substring)
  assert.throws(() => registry.register(new SubstringRetriever()), (error) => error instanceof InvalidInputError)
  assert.throws(() => registry.resolve('nope'), (error) => error instanceof RetrievalNotFoundError)
  disposer()
  assert.equal(registry.get('substring'), undefined)
})

test('RetrievalProviderRegistry：非法契约响亮失败', () => {
  const registry = new RetrievalProviderRegistry()
  assert.throws(() => registry.register(null), (error) => error instanceof InvalidInputError)
  assert.throws(() => registry.register({ id: 'Bad_Id', name: 'x', description: 'x', kind: 'vector', retrieve: () => [] }), (error) => error instanceof InvalidInputError)
  assert.throws(() => registry.register({ id: 'ok', name: '', description: 'x', kind: 'vector', retrieve: () => [] }), (error) => error instanceof InvalidInputError)
  assert.throws(() => registry.register({ id: 'ok', name: 'x', description: '', kind: 'vector', retrieve: () => [] }), (error) => error instanceof InvalidInputError)
  assert.throws(() => registry.register({ id: 'ok', name: 'x', description: 'x', kind: 'fuzzy', retrieve: () => [] }), (error) => error instanceof InvalidInputError)
  assert.throws(() => registry.register({ id: 'ok', name: 'x', description: 'x', kind: 'vector' }), (error) => error instanceof InvalidInputError)
})

/** 集成挂载：临时库 + 自动放行审批 + 可选 retrieval 配置。 */
function mount(opts = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-memento-retrieval-'))
  const dbPath = path.join(dir, 'memory.db')
  const mock = createMockCtx()
  mock.ctx.approval = { request: async () => 'allowed-once', overrideOf: () => undefined, config: { policy: 'auto' } }
  mock.ctx.provide('commands', { register() { return () => {} } })
  apply(mock.ctx, {
    enabled: true,
    dbPath,
    budgets: DEFAULT_BUDGETS,
    writePolicy: 'auto',
    language: 'en',
    recall: { historyLimitDefault: 8, snippetCap: 5, snippetChars: 300, windowDays: 30 },
    retrieval: opts.retrieval ?? { vector: false },
  })
  return { dir, mock }
}

function teardown(mounted) {
  mounted.mock.dispose()
  rmSync(mounted.dir, { recursive: true, force: true })
}

test('retrieval 接线：vector 开关控制 memoryRetrieval/memoryEmbedding 注册面', (t) => {
  const mounted = mount({ retrieval: { vector: true } })
  t.after(() => teardown(mounted))
  const { mock } = mounted
  const embeddings = mock.services.get('memoryEmbedding')
  const retrievers = mock.services.get('memoryRetrieval')
  assert.ok(embeddings, 'memoryEmbedding 服务已提供')
  assert.ok(retrievers, 'memoryRetrieval 服务已提供')
  assert.ok(embeddings.get('fake-hash'), '默认伪嵌入 provider 已注册')
  assert.ok(retrievers.get('substring'), '内置 substring 检索器已注册')
  assert.ok(retrievers.get('vector'), 'vector=true 时 vector 检索器已注册')
})

test('retrieval 接线：vector=false（默认）不注册 vector 检索器', (t) => {
  const mounted = mount()
  t.after(() => teardown(mounted))
  const retrievers = mounted.mock.services.get('memoryRetrieval')
  assert.equal(retrievers.get('vector'), undefined)
})

test('memory_recall：vector=true 语义召回（无精确子串仍命中 token 重叠条目）', async (t) => {
  const mounted = mount({ retrieval: { vector: true } })
  t.after(() => teardown(mounted))
  const service = mounted.mock.services.get('memory')
  const session = makeSession()
  const write = { agent: makeAgent(session) }
  await service.add({ track: 'user', scope: 'user-global', text: 'favorite drink is lapsang souchong' }, write)
  await service.add({ track: 'user', scope: 'user-global', text: 'quantum gravity is hard' }, write)
  const tool = mounted.mock.tools.find((t) => t.name === 'memory_recall')
  const result = await tool.execute({ query: 'tea lapsang' }, makeExec({ agent: makeAgent(session) }))
  assert.equal(result.ok, true)
  assert.ok(result.memory.total >= 1, '语义召回命中 token 重叠条目')
  assert.equal(result.memory.entries[0].text, 'favorite drink is lapsang souchong')
})

test('memory_recall：默认 substring 主路径保持子串语义（无子串则零命中）', async (t) => {
  const mounted = mount()
  t.after(() => teardown(mounted))
  const service = mounted.mock.services.get('memory')
  const session = makeSession()
  await service.add({ track: 'user', scope: 'user-global', text: 'favorite drink is lapsang souchong' }, { agent: makeAgent(session) })
  const tool = mounted.mock.tools.find((t) => t.name === 'memory_recall')
  const hit = await tool.execute({ query: 'lapsang' }, makeExec({ agent: makeAgent(session) }))
  assert.equal(hit.memory.total, 1)
  const miss = await tool.execute({ query: 'tea lapsang' }, makeExec({ agent: makeAgent(session) }))
  assert.equal(miss.memory.total, 0)
})
