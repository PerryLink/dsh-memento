// test/proposals.test.mjs — auto-capture 提案集成测试：session/event 火线 → 提案落库、
// 快照提案块、/memory proposals 命令、面板只读路由、enabled/maxPending 边界。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  apply,
  handleMemoryCommand,
  DEFAULT_BUDGETS,
} from '../index.mjs'
import { createMockCtx, makeSession, makeAgent } from './helpers/mock-ctx.mjs'

/** 经 mock 事件总线裁决的审批服务（与 v2 集成测试同款）。 */
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
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-memento-prop-'))
  const dbPath = path.join(dir, 'memory.db')
  const mock = createMockCtx()
  const approval = makeBusApproval(mock.ctx)
  mock.ctx.approval = approval
  const commands = []
  mock.ctx.provide('commands', { register(def) { commands.push(def); return () => {} } })
  if (opts.webServer) mock.ctx.provide('webServer', opts.webServer)
  apply(mock.ctx, {
    enabled: opts.enabled ?? true,
    dbPath,
    budgets: DEFAULT_BUDGETS,
    writePolicy: opts.writePolicy ?? 'auto',
    snapshotOrder: -50,
    maxEntriesPerQuery: 20,
    commandListLimit: 50,
    commandAuditLimit: 10,
    language: 'zh',
    recall: { historyLimitDefault: 8, snippetCap: 5, snippetChars: 300 },
    panelEntriesLimit: 200,
    panelAuditLimit: 20,
    auditRetentionDays: 0,
    proposals: opts.proposals ?? { enabled: true, maxChars: 2000, maxPending: 8 },
  })
  return { dir, dbPath, mock, approval, commands }
}

function teardown(mounted) {
  mounted.mock.dispose()
  rmSync(mounted.dir, { recursive: true, force: true })
}

/** 触发一次成功压缩：summary → end（error 缺省）。 */
function emitCompaction(ctx, session, summary = '压缩摘要文本') {
  ctx.emit('session/event', session, { type: 'compaction/summary', data: { summary: [{ type: 'text', text: summary }] } })
  ctx.emit('session/event', session, { type: 'compaction/end', data: { error: undefined } })
}

test('auto-capture：压缩成功后生成 pending 提案并落审计；同会话幂等；error 不生成', (t) => {
  const mounted = mount()
  t.after(() => teardown(mounted))
  const { mock } = mounted
  const service = mock.services.get('memory')
  const session = makeSession({ id: 's-compact' })
  emitCompaction(mock.ctx, session, '压缩摘要甲')
  const pending = service.store.proposalList('pending')
  assert.equal(pending.length, 1)
  assert.equal(pending[0].kind, 'compaction-summary')
  assert.equal(pending[0].track, 'agent')
  assert.equal(pending[0].scope, 'workspace')
  assert.equal(pending[0].text, '压缩摘要甲')
  assert.equal(pending[0].sessionId, 's-compact')

  emitCompaction(mock.ctx, session, '压缩摘要乙')
  assert.equal(service.store.proposalList('pending').length, 1, '(session_id, kind) 幂等')

  const sessionErr = makeSession({ id: 's-err' })
  mock.ctx.emit('session/event', sessionErr, { type: 'compaction/summary', data: { summary: [{ type: 'text', text: '失败摘要' }] } })
  mock.ctx.emit('session/event', sessionErr, { type: 'compaction/end', data: { error: 'boom' } })
  assert.equal(service.store.proposalList('pending').length, 1, 'error 压缩不生成提案')

  const audit = service.store.auditList().filter((row) => row.action === 'proposal')
  assert.equal(audit.length, 1)
  assert.equal(audit[0].text, '压缩摘要甲')
  assert.equal(audit[0].sessionId, 's-compact')
})

test('auto-capture：maxPending 满则弃新；proposals.enabled=false 整体关闭', (t) => {
  const capped = mount({ proposals: { enabled: true, maxChars: 2000, maxPending: 1 } })
  t.after(() => teardown(capped))
  emitCompaction(capped.mock.ctx, makeSession({ id: 's-a' }), '甲')
  emitCompaction(capped.mock.ctx, makeSession({ id: 's-b' }), '乙')
  const pending = capped.mock.services.get('memory').store.proposalList('pending')
  assert.equal(pending.length, 1, '满则弃新')
  assert.equal(pending[0].text, '甲')

  const off = mount({ proposals: { enabled: false, maxChars: 2000, maxPending: 8 } })
  t.after(() => teardown(off))
  emitCompaction(off.mock.ctx, makeSession({ id: 's-off' }), '丙')
  assert.equal(off.mock.services.get('memory').store.proposalList('pending').length, 0, 'enabled:false 不生成提案')
})

test('maxChars 截断：超长摘要按 proposals.maxChars 截断落库', (t) => {
  const mounted = mount({ proposals: { enabled: true, maxChars: 5, maxPending: 8 } })
  t.after(() => teardown(mounted))
  emitCompaction(mounted.mock.ctx, makeSession({ id: 's-long' }), '1234567890')
  const pending = mounted.mock.services.get('memory').store.proposalList('pending')
  assert.equal(pending.length, 1)
  assert.equal(pending[0].text, '12345')
})

test('快照包含 pending 提案块（模型可见 ⟺ 随快照文本进入 request/header.system 可重建）', (t) => {
  const mounted = mount()
  t.after(() => teardown(mounted))
  const { mock } = mounted
  emitCompaction(mock.ctx, makeSession({ id: 's-src' }), '跨会话建议')
  const section = mock.sections.find((s) => s.name === 'dsh-memento:memory')
  const text = section.text({ agent: { session: makeSession({ id: 's-view' }) } })
  assert.ok(text.includes('待审批记忆提案'), '提案块进入冻结快照')
  assert.ok(text.includes('跨会话建议'))
  // 冻结语义：同一会话第二次 assemble 逐字一致
  const frozenSession = makeSession({ id: 's-view' })
  const first = section.text({ agent: { session: frozenSession } })
  assert.equal(section.text({ agent: { session: frozenSession } }), first)
})

test('/memory proposals：list / approve（写入走审批门）/ dismiss / 重复裁决响亮', async (t) => {
  const mounted = mount({ writePolicy: 'auto' })
  t.after(() => teardown(mounted))
  const { mock } = mounted
  const service = mock.services.get('memory')
  emitCompaction(mock.ctx, makeSession({ id: 's-p1' }), '提案条目一')
  const invocation = { agent: makeAgent(makeSession()), signal: new AbortController().signal }

  const list = await handleMemoryCommand(mock.ctx, service, { ...invocation, rawInput: 'proposals' })
  assert.equal(list.kind, 'success')
  assert.ok(list.text.includes('待审批提案（1 条）'))

  const id = service.store.proposalList('pending')[0].id
  const approved = await handleMemoryCommand(mock.ctx, service, { ...invocation, rawInput: `proposals approve ${id}` })
  assert.ok(approved.text.includes('已批准提案'))
  const entries = service.query({ track: 'agent', scope: 'workspace' })
  assert.equal(entries.total, 1)
  assert.equal(entries.entries[0].text, '提案条目一')
  assert.equal(entries.entries[0].source, 'proposal')
  const audit = service.store.auditList()
  assert.equal(audit[0].outcome, 'allowed-once (via write gate)', 'approve 写入走命令审批门')

  const again = await handleMemoryCommand(mock.ctx, service, { ...invocation, rawInput: `proposals approve ${id}` })
  assert.equal(again.kind, 'error', '已裁决提案再 approve 响亮报错')

  emitCompaction(mock.ctx, makeSession({ id: 's-p2' }), '提案条目二')
  const id2 = service.store.proposalList('pending')[0].id
  const dismissed = await handleMemoryCommand(mock.ctx, service, { ...invocation, rawInput: `proposals dismiss ${id2}` })
  assert.ok(dismissed.text.includes('已驳回'))
  assert.equal(service.store.proposalList('pending').length, 0)
  assert.equal(service.query({}).total, 1, 'dismiss 不写任何条目')
})

test('面板 proposals 路由只读返回 pending 列表', async (t) => {
  const routes = []
  const mounted = mount({ webServer: { register(route) { routes.push(route); return () => {} } } })
  t.after(() => teardown(mounted))
  emitCompaction(mounted.mock.ctx, makeSession({ id: 's-panel' }), '面板可见提案')
  const route = routes.find((r) => r.path === '/api/memento/proposals')
  assert.ok(route)
  let captured = ''
  await route.handler({ url: '/api/memento/proposals', method: 'GET' }, { writeHead() {}, end(body) { captured = body } })
  const data = JSON.parse(captured)
  assert.equal(data.proposals.length, 1)
  assert.equal(data.proposals[0].text, '面板可见提案')
})
