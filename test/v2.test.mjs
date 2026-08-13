// test/v2.test.mjs — V2 观察面集成测试：/memory 命令（turn 外审批门）、
// memory_recall 工具（记忆+历史两段式）、面板只读路由、禁用全撤回。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  apply,
  handleMemoryCommand,
  renderMemoryRecallResult,
  MemoryService,
  WriteDeniedError,
  DEFAULT_BUDGETS,
} from '../index.mjs'
import { createMockCtx, makeSession, makeAgent, makeExec } from './helpers/mock-ctx.mjs'

/** 经 mock 事件总线裁决的审批服务（同 V1 集成测试）。 */
function makeBusApproval(ctx) {
  return {
    asked: [],
    config: { policy: 'ask' },
    overrideOf() { return undefined },
    async request(req) {
      this.asked.push(req)
      return ctx.waterfall('approval/request', req, async () => 'unavailable')
    },
  }
}

function mount(opts = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-memento-v2-'))
  const dbPath = path.join(dir, 'memory.db')
  const mock = createMockCtx()
  const approval = opts.approval ?? makeBusApproval(mock.ctx)
  mock.ctx.approval = approval
  const commands = []
  mock.ctx.provide('commands', { register(def) { commands.push(def); return () => {} } })
  if (opts.webServer) mock.ctx.provide('webServer', opts.webServer)
  if (opts.sessionQuery) mock.ctx.provide('sessionQuery', opts.sessionQuery)
  apply(mock.ctx, {
    enabled: opts.enabled ?? true,
    dbPath,
    budgets: opts.budgets ?? DEFAULT_BUDGETS,
    writePolicy: opts.writePolicy ?? 'auto',
    snapshotOrder: -50,
    maxEntriesPerQuery: 20,
  })
  return { dir, dbPath, mock, approval, commands }
}

function teardown(mounted) {
  mounted.mock.dispose()
  rmSync(mounted.dir, { recursive: true, force: true })
}

test('F10：/memory 命令注册；list/query/budgets/audit 直接读', async (t) => {
  const mounted = mount()
  t.after(() => teardown(mounted))
  const { mock, commands } = mounted
  assert.equal(commands.length, 1)
  assert.equal(commands[0].name, 'memory')
  const service = mock.services.get('memory')
  await service.add(
    { track: 'agent', scope: 'workspace', text: '项目约定：测试先于实现' },
    { agent: makeAgent(makeSession({ id: 's-cmd' })) },
  )
  const invocation = { rawInput: '', agent: makeAgent(makeSession()), signal: new AbortController().signal }
  const list = await handleMemoryCommand(mock.ctx, service, { ...invocation, rawInput: 'list' })
  assert.equal(list.kind, 'success')
  assert.ok(list.text.includes('项目约定：测试先于实现'))
  const query = await handleMemoryCommand(mock.ctx, service, { ...invocation, rawInput: 'query 测试' })
  assert.ok(query.text.includes('命中 1 条'))
  const budgets = await handleMemoryCommand(mock.ctx, service, { ...invocation, rawInput: 'budgets' })
  assert.ok(budgets.text.includes('agent/workspace'))
  const audit = await handleMemoryCommand(mock.ctx, service, { ...invocation, rawInput: 'audit' })
  assert.ok(audit.text.includes('add'))
})

test('F10：命令 add/remove 走 turn 外审批门（同一 waterfall + writePolicy）', async (t) => {
  const mounted = mount({ writePolicy: 'auto' })
  t.after(() => teardown(mounted))
  const { mock, approval } = mounted
  const service = mock.services.get('memory')
  const invocation = { agent: makeAgent(makeSession({ id: 's-cmdw' })), signal: new AbortController().signal }
  const added = await handleMemoryCommand(mock.ctx, service, {
    ...invocation,
    rawInput: 'add --track=agent --scope=workspace 手动添加的约定',
  })
  assert.equal(added.kind, 'success')
  assert.equal(service.query({ track: 'agent', scope: 'workspace' }).total, 1)
  const audit = service.store.auditList()
  assert.equal(audit[0].action, 'add')
  assert.equal(audit[0].source, 'command')
  const removed = await handleMemoryCommand(mock.ctx, service, {
    ...invocation,
    rawInput: 'remove --track=agent --scope=workspace 手动添加',
  })
  assert.equal(removed.kind, 'success')
  assert.equal(service.query({ track: 'agent', scope: 'workspace' }).total, 0)
  // 无 agent 的命令写失败封闭
  const noAgent = await handleMemoryCommand(mock.ctx, service, { rawInput: 'add x', signal: new AbortController().signal })
  assert.equal(noAgent.kind, 'error')
  assert.ok(noAgent.text.includes('WRITE_REQUIRES_AGENT'))
  assert.equal(approval.asked.length, 0, '命令路径不产生 turn 内审批对（turn 外），审计走审计表')
})

test('F10：ask 策略下命令写无 answerer 时失败封闭；会话 never 策略拒绝且不派发', async (t) => {
  const askMounted = mount({ writePolicy: 'ask' })
  t.after(() => teardown(askMounted))
  const service = askMounted.mock.services.get('memory')
  const invocation = { agent: makeAgent(makeSession()), signal: new AbortController().signal }
  const denied = await handleMemoryCommand(askMounted.mock.ctx, service, { ...invocation, rawInput: 'add 无审批人' })
  assert.equal(denied.kind, 'error')
  assert.ok(denied.text.includes('WRITE_DENIED'))
  assert.equal(service.query({}).total, 0)

  const neverMounted = mount({
    writePolicy: 'ask',
    approval: {
      config: { policy: 'ask' },
      overrideOf() { return 'never' },
      async request() { throw new Error('never 策略下审批服务不应被派发') },
    },
  })
  t.after(() => teardown(neverMounted))
  const neverDenied = await handleMemoryCommand(neverMounted.mock.ctx, neverMounted.mock.services.get('memory'), {
    ...invocation,
    rawInput: 'add 永不通过',
  })
  assert.equal(neverDenied.kind, 'error')
  assert.ok(neverDenied.text.includes('WRITE_DENIED'))
  assert.equal(neverMounted.mock.services.get('memory').query({}).total, 0)
})

test('F11：memory_recall 合并记忆与近期会话历史（两段式）', async (t) => {
  const fakeSessionQuery = {
    async filterSessions() {
      return [{ id: 's-old-1' }, { id: 's-old-2' }]
    },
    async filterEvents(sessionId, filters) {
      if (sessionId === 's-old-1') {
        return [
          { type: 'user/message', data: { content: [{ type: 'text', text: '历史片段甲：曾讨论过验证饮料' }] } },
          { type: 'assistant/message', data: { content: [{ type: 'text', text: '历史片段乙' }] } },
        ]
      }
      return []
    },
    extractSessionEventText(event) {
      return event.data.content.map((part) => part.text).join('\n')
    },
  }
  const mounted = mount({ sessionQuery: fakeSessionQuery })
  t.after(() => teardown(mounted))
  const { mock } = mounted
  const service = mock.services.get('memory')
  await service.add(
    { track: 'user', scope: 'user-global', text: '验证饮料是 lapsang' },
    { agent: makeAgent(makeSession()) },
  )
  const tool = mock.tools.find((t) => t.name === 'memory_recall')
  assert.ok(tool, 'memory_recall 工具已注册')
  const result = await tool.execute({ query: '饮料' }, makeExec({ agent: makeAgent(makeSession()) }))
  assert.equal(result.ok, true)
  assert.equal(result.memory.entries.length, 1)
  assert.equal(result.memory.total, 1)
  assert.equal(result.history.available, true)
  assert.equal(result.history.sessions.length, 1)
  assert.equal(result.history.sessions[0].sessionId, 's-old-1')
  assert.equal(result.history.sessions[0].matches, 2)
  assert.ok(result.history.sessions[0].snippets[0].includes('历史片段甲'))
  const rendered = renderMemoryRecallResult({}, result)
  assert.deepEqual(rendered, renderMemoryRecallResult({}, structuredClone(result)))
  assert.ok(rendered[0].text.includes('memory: 1 match'))
  assert.ok(rendered[0].text.includes('s-old-1'))
})

test('F11：sessionQuery 缺失时 memory_recall 降级为纯记忆结果（不报错）', async (t) => {
  const mounted = mount()
  t.after(() => teardown(mounted))
  const { mock } = mounted
  const tool = mock.tools.find((t) => t.name === 'memory_recall')
  const result = await tool.execute({ query: '任何词' }, makeExec())
  assert.equal(result.ok, true)
  assert.equal(result.history.available, false)
  assert.deepEqual(result.history.sessions, [])
})

test('F9：面板路由只读——entries（含预算）与 audit（上限钳制）', async (t) => {
  const routes = []
  const mounted = mount({ webServer: { register(route) { routes.push(route); return () => {} } } })
  t.after(() => teardown(mounted))
  const service = mounted.mock.services.get('memory')
  await service.add(
    { track: 'user', scope: 'user-global', text: '面板可见条目' },
    { agent: makeAgent(makeSession()) },
  )
  assert.equal(routes.length, 2)
  assert.deepEqual(routes.map((route) => route.path).sort(), ['/api/memento/audit', '/api/memento/entries'])

  const entriesRoute = routes.find((route) => route.path === '/api/memento/entries')
  let captured = ''
  await entriesRoute.handler(
    { url: '/api/memento/entries?text=面板', method: 'GET' },
    { writeHead() {}, end(body) { captured = body } },
  )
  const entriesData = JSON.parse(captured)
  assert.equal(entriesData.total, 1)
  assert.ok(Array.isArray(entriesData.budgets))
  assert.equal(entriesData.budgets.length, 4)

  const auditRoute = routes.find((route) => route.path === '/api/memento/audit')
  captured = ''
  await auditRoute.handler(
    { url: '/api/memento/audit?limit=500', method: 'GET' },
    { writeHead() {}, end(body) { captured = body } },
  )
  const auditData = JSON.parse(captured)
  assert.ok(Array.isArray(auditData.rows))
  assert.ok(auditData.rows.length <= 20, 'limit 钳制到 20')
})

test('S3：enabled:false 时 V2 观察面一并消失', (t) => {
  const mounted = mount({ enabled: false })
  t.after(() => teardown(mounted))
  const { mock, commands } = mounted
  assert.equal(commands.length, 0, '命令未注册')
  assert.equal(mock.tools.some((tool) => tool.name === 'memory_recall'), false)
  assert.equal(mock.tools.some((tool) => tool.name === 'memory'), false)
  assert.equal(mock.services.get('memory'), undefined)
})
