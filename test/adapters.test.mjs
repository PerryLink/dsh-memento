// test/adapters.test.mjs — 协议 v1 适配器注册表与参考适配器测试：
// 注册可逆 / id 冲突响亮 / mem0·Hermes·CLAUDE.md 三适配器往返 / 命令动词集成。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MemoryAdapterRegistry } from '../lib/registry.mjs'
import { REFERENCE_ADAPTERS } from '../lib/adapters.mjs'
import { AdapterNotFoundError, AdapterPayloadError, InvalidInputError, MemoryError } from '../lib/errors.mjs'
import { apply, handleMemoryCommand, DEFAULT_BUDGETS } from '../index.mjs'
import { createMockCtx, makeSession, makeAgent } from './helpers/mock-ctx.mjs'

test('注册表：register 返回 disposer，list 排序稳定，注销后查询报 ADAPTER_NOT_FOUND', () => {
  const registry = new MemoryAdapterRegistry()
  assert.equal(registry.list().length, 0)
  const dispose = registry.register(REFERENCE_ADAPTERS[0])
  assert.equal(registry.list().length, 1)
  assert.equal(registry.list()[0].id, 'mem0')
  dispose()
  assert.equal(registry.list().length, 0)
  assert.throws(() => registry.adapt('mem0', []), AdapterNotFoundError)
  assert.throws(() => registry.export('mem0', []), AdapterNotFoundError)
})

test('注册表：同 id 重复注册与非法适配器形状响亮失败', () => {
  const registry = new MemoryAdapterRegistry()
  registry.register(REFERENCE_ADAPTERS[0])
  assert.throws(() => registry.register(REFERENCE_ADAPTERS[0]), InvalidInputError)
  assert.throws(() => registry.register({}), InvalidInputError)
  assert.throws(() => registry.register({ ...REFERENCE_ADAPTERS[0], id: 'Bad Id!' }), InvalidInputError)
  assert.throws(() => registry.register({ ...REFERENCE_ADAPTERS[0], adapt: 'not-a-function' }), InvalidInputError)
  assert.throws(() => registry.register({ ...REFERENCE_ADAPTERS[0], export: 'not-a-function' }), InvalidInputError)
  assert.throws(() => registry.register({ ...REFERENCE_ADAPTERS[0], name: '' }), InvalidInputError)
  assert.throws(() => registry.register({ ...REFERENCE_ADAPTERS[0], description: '' }), InvalidInputError)
  assert.throws(() => registry.register({ ...REFERENCE_ADAPTERS[0], version: '' }), InvalidInputError)
  assert.throws(() => registry.register({ ...REFERENCE_ADAPTERS[0], importFormats: [] }), InvalidInputError)
  assert.throws(() => registry.register({ ...REFERENCE_ADAPTERS[0], importFormats: [1] }), InvalidInputError)
  assert.throws(() => registry.register({ ...REFERENCE_ADAPTERS[0], exportFormat: '' }), InvalidInputError)
  assert.throws(() => registry.register(null), InvalidInputError)
})

test('注册表：适配器内部抛错包装为 ADAPTER_PAYLOAD，领域错误原样透传', () => {
  const registry = new MemoryAdapterRegistry()
  registry.register({
    id: 'boom',
    name: 'boom',
    description: 'throws',
    version: '1.0.0',
    importFormats: ['boom'],
    exportFormat: 'boom',
    adapt() { throw new Error('internal boom') },
    export() { throw new AdapterPayloadError('boom', 'export boom') },
  })
  try {
    registry.adapt('boom', {})
    assert.fail('should have thrown')
  } catch (error) {
    assert.ok(error instanceof AdapterPayloadError)
    assert.equal(error.code, 'ADAPTER_PAYLOAD')
    assert.match(error.message, /internal boom/)
  }
  try {
    registry.export('boom', [])
    assert.fail('should have thrown')
  } catch (error) {
    assert.ok(error instanceof AdapterPayloadError)
    assert.match(error.message, /export boom/)
  }
})

test('mem0 适配器：facts 数组与 {facts} 信封 → 条目；messages 载荷响亮拒绝（只转换不抽取）', () => {
  const registry = new MemoryAdapterRegistry()
  registry.register(REFERENCE_ADAPTERS[0])
  const facts = [
    { memory: '用户偏好中文', metadata: { category: 'pref' } },
    { memory: '项目使用 pnpm', user_id: 'u1' },
  ]
  const viaArray = registry.adapt('mem0', facts)
  assert.equal(viaArray.entries.length, 2)
  assert.equal(viaArray.entries[0].track, 'user')
  assert.equal(viaArray.entries[0].scope, 'user-global')
  assert.equal(viaArray.entries[0].source, 'mem0')
  assert.deepEqual(viaArray.entries[0].tags, ['pref'])
  assert.deepEqual(viaArray.entries[1].tags, [])
  const viaEnvelope = registry.adapt('mem0', { facts })
  assert.equal(viaEnvelope.entries.length, 2)
  assert.throws(() => registry.adapt('mem0', { messages: [{ role: 'user', content: 'hi' }] }), AdapterPayloadError)
  assert.throws(() => registry.adapt('mem0', [{ id: 'x' }]), AdapterPayloadError)
})

test('mem0 适配器：导出 shape（plugin/facts/metadata 往返字段）', () => {
  const registry = new MemoryAdapterRegistry()
  registry.register(REFERENCE_ADAPTERS[0])
  const payload = registry.export('mem0', [{
    id: '123e4567-e89b-42d3-a456-426614174000',
    track: 'user',
    scope: 'user-global',
    workspaceKey: '',
    agentKey: '',
    text: '导出条目',
    source: 'mem0',
    tags: ['t'],
    version: 1,
    createdAt: 1000,
    updatedAt: 2000,
    lastRecalled: null,
    recallCount: 0,
    sessionId: null,
  }])
  assert.equal(/** @type {{plugin: string}} */ (payload).plugin, 'mem0')
  const exported = /** @type {{facts: Array<{memory: string, metadata: {track: string}}>}} */ (payload)
  assert.equal(exported.facts[0].memory, '导出条目')
  assert.equal(exported.facts[0].metadata.track, 'user')
  const roundTrip = registry.adapt('mem0', payload)
  assert.equal(roundTrip.entries[0].text, '导出条目')
  assert.deepEqual(roundTrip.entries[0].tags, ['t'])
})

test('hermes-memory-md 适配器：小节成标签、项目符号成条目；散文行响亮失败', () => {
  const registry = new MemoryAdapterRegistry()
  registry.register(REFERENCE_ADAPTERS[1])
  const doc = [
    '## About the user',
    '- 喜欢简洁回答',
    '- 雷区：不要重构他的测试',
    '## Preferences',
    '- 用中文交流',
  ].join('\n')
  const { entries } = registry.adapt('hermes-memory-md', doc)
  assert.equal(entries.length, 3)
  assert.deepEqual(entries[0].tags, ['About the user'])
  assert.equal(entries[0].text, '喜欢简洁回答')
  assert.equal(entries[2].text, '用中文交流')
  assert.throws(() => registry.adapt('hermes-memory-md', '## S\n这是一行散文'), AdapterPayloadError)
  assert.throws(() => registry.adapt('hermes-memory-md', 42), AdapterPayloadError)
})

test('claude-code-memory-md 适配器：项目符号 + 段落（空行分段）都成条目', () => {
  const registry = new MemoryAdapterRegistry()
  registry.register(REFERENCE_ADAPTERS[2])
  const doc = [
    '## Style',
    '- 回复带代码示例',
    '',
    '用户喜欢把长任务拆成小步。',
    '每一步都要验收清单。',
  ].join('\n')
  const { entries } = registry.adapt('claude-code-memory-md', doc)
  assert.equal(entries.length, 2)
  assert.equal(entries[0].text, '回复带代码示例')
  assert.equal(entries[1].text, '用户喜欢把长任务拆成小步。 每一步都要验收清单。')
  assert.deepEqual(entries[1].tags, ['Style'])
})

test('markdown 导出：按 track/scope 分组；hermes 适配器可读回', () => {
  const registry = new MemoryAdapterRegistry()
  registry.register(REFERENCE_ADAPTERS[1])
  const entry = (/** @type {string} */ text) => ({
    id: '123e4567-e89b-42d3-a456-426614174000',
    track: 'user',
    scope: 'user-global',
    workspaceKey: '',
    agentKey: '',
    text,
    source: 'hermes-memory-md',
    tags: [],
    version: 1,
    createdAt: 1000,
    updatedAt: 1000,
    lastRecalled: null,
    recallCount: 0,
    sessionId: null,
  })
  const payload = registry.export('hermes-memory-md', [entry('第一条'), entry('第二条')])
  const text = /** @type {{text: string}} */ (payload).text
  assert.ok(text.includes('## user/user-global'))
  assert.ok(text.includes('- 第一条'))
  const back = registry.adapt('hermes-memory-md', payload)
  assert.deepEqual(back.entries.map((/** @type {{text: string}} */ e) => e.text), ['第一条', '第二条'])
})

// ── 命令动词集成（mount 样式同 v2.test.mjs）────────────────────────────────────

function mount(opts = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-memento-adapters-'))
  const dbPath = path.join(dir, 'memory.db')
  const mock = createMockCtx()
  mock.ctx.approval = {
    asked: [],
    config: { policy: 'ask' },
    overrideOf() { return undefined },
    async request(req) {
      this.asked.push(req)
      return mock.ctx.waterfall('approval/request', req, async () => 'unavailable')
    },
  }
  const commands = []
  mock.ctx.provide('commands', { register(def) { commands.push(def); return () => {} } })
  apply(mock.ctx, {
    enabled: opts.enabled ?? true,
    dbPath,
    budgets: opts.budgets ?? DEFAULT_BUDGETS,
    writePolicy: opts.writePolicy ?? 'auto',
    snapshotOrder: -50,
    maxEntriesPerQuery: 20,
    commandListLimit: 50,
    commandAuditLimit: 10,
    language: opts.language ?? 'en',
    recall: { historyLimitDefault: 8, snippetCap: 5, snippetChars: 300, windowDays: 30 },
    panelEntriesLimit: 200,
    panelAuditLimit: 20,
    auditRetentionDays: 0,
  })
  return { dir, dbPath, mock, commands }
}

function teardown(mounted) {
  mounted.mock.dispose()
  rmSync(mounted.dir, { recursive: true, force: true })
}

test('命令：adapters 列出内置参考适配器（mem0/hermes/claude）', async (t) => {
  const mounted = mount()
  t.after(() => teardown(mounted))
  const service = mounted.mock.services.get('memory')
  const result = await handleMemoryCommand(mounted.mock.ctx, service, { rawInput: 'adapters' })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /mem0/)
  assert.match(result.text, /hermes-memory-md/)
  assert.match(result.text, /claude-code-memory-md/)
})

test('命令：export --adapter=mem0 输出只读转换；未知适配器响亮报错', async (t) => {
  const mounted = mount()
  t.after(() => teardown(mounted))
  const service = mounted.mock.services.get('memory')
  await service.add(
    { track: 'user', scope: 'user-global', text: '导出我' },
    { agent: makeAgent(makeSession({ id: 's-exp' })) },
  )
  const exported = await handleMemoryCommand(mounted.mock.ctx, service, { rawInput: 'export --adapter=mem0' })
  assert.equal(exported.kind, 'success')
  const payload = JSON.parse(exported.text)
  assert.equal(payload.plugin, 'mem0')
  assert.equal(payload.facts[0].memory, '导出我')
  const unknown = await handleMemoryCommand(mounted.mock.ctx, service, { rawInput: 'export --adapter=nope' })
  assert.equal(unknown.kind, 'error')
  assert.match(unknown.text, /nope/)
  const badFlag = await handleMemoryCommand(mounted.mock.ctx, service, { rawInput: 'export --adapter=' })
  assert.equal(badFlag.kind, 'error')
})

test('命令：import --adapter 走审批门落库（文件路径与内联 JSON）；坏载荷响亮报错', async (t) => {
  const mounted = mount()
  t.after(() => teardown(mounted))
  const service = mounted.mock.services.get('memory')
  const invocation = { agent: makeAgent(makeSession({ id: 's-imp' })) }
  const file = path.join(mounted.dir, 'facts.json')
  writeFileSync(file, JSON.stringify({ facts: [{ memory: '文件导入的记忆' }] }), 'utf8')
  const viaFile = await handleMemoryCommand(mounted.mock.ctx, service, { ...invocation, rawInput: `import --adapter=mem0 ${file}` })
  assert.equal(viaFile.kind, 'success')
  assert.match(viaFile.text, /Imported 1 entries via adapter mem0/)
  const viaInline = await handleMemoryCommand(mounted.mock.ctx, service, { ...invocation, rawInput: 'import --adapter=mem0 {"facts":[{"memory":"内联导入的记忆"}]}' })
  assert.equal(viaInline.kind, 'success')
  const entries = service.query()
  assert.equal(entries.total, 2)
  const bad = await handleMemoryCommand(mounted.mock.ctx, service, { ...invocation, rawInput: 'import --adapter=mem0 {"messages":[{"role":"user"}]}' })
  assert.equal(bad.kind, 'error')
  assert.match(bad.text, /mem0/)
  const unknown = await handleMemoryCommand(mounted.mock.ctx, service, { ...invocation, rawInput: 'import --adapter=nope {}' })
  assert.equal(unknown.kind, 'error')
  assert.match(unknown.text, /nope/)
})

test('命令：import --adapter=hermes-memory-md 读 markdown 文件并逐条落库（审计可见）', async (t) => {
  const mounted = mount()
  t.after(() => teardown(mounted))
  const service = mounted.mock.services.get('memory')
  const invocation = { agent: makeAgent(makeSession({ id: 's-md' })) }
  const file = path.join(mounted.dir, 'memory.md')
  writeFileSync(file, '## About\n- 第一条\n- 第二条\n', 'utf8')
  const result = await handleMemoryCommand(mounted.mock.ctx, service, { ...invocation, rawInput: `import --adapter=hermes-memory-md ${file}` })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /Imported 2 entries via adapter hermes-memory-md/)
  const entries = service.query()
  assert.equal(entries.total, 2)
  const audit = service.store.auditList(20)
  assert.equal(audit.filter((/** @type {{action: string}} */ row) => row.action === 'add').length, 2)
  const seeds = audit.filter((/** @type {{action: string}} */ row) => row.action === 'seed')
  assert.equal(seeds.length, 1)
})

test('命令：adapter 动词在服务缺失/禁用时响亮报缺（不静默吞掉）', async (t) => {
  const mounted = mount({ enabled: false })
  t.after(() => teardown(mounted))
  assert.equal(mounted.mock.services.get('memoryAdapters'), undefined)
})
