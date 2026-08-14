// test/index.test.mjs — mock ctx 集成测试：服务注册/effect 撤回/审批门不可绕过/
// 注入可重建/enabled:false 全撤回/工具规范 JSON。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  apply,
  Config,
  MemoryService,
  MemoryError,
  InvalidInputError,
  BudgetExceededError,
  EntryNotFoundError,
  AmbiguousMatchError,
  WriteDeniedError,
  NoAgentError,
  renderMemoryResult,
  DEFAULT_BUDGETS,
} from '../index.mjs'
import { createMockCtx, makeSession, makeAgent, makeExec } from './helpers/mock-ctx.mjs'
import { parseWriteReason } from '../lib/gate.mjs'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'

/** 经 mock 事件总线裁决的审批服务（对齐真 ApprovalService 的 waterfall 派发）。 */
function makeBusApproval(ctx) {
  const asked = []
  return {
    asked,
    async request(req) {
      asked.push(req)
      return ctx.waterfall('approval/request', req, async () => 'unavailable')
    },
  }
}

/** 临时目录 + 显式 dbPath 挂载（不依赖 $DSH_HOME）。 */
function mount(opts = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-memento-it-'))
  const dbPath = path.join(dir, 'memory.db')
  const mock = createMockCtx()
  const approval = makeBusApproval(mock.ctx)
  mock.ctx.approval = approval
  const config = {
    enabled: opts.enabled ?? true,
    dbPath,
    budgets: opts.budgets ?? DEFAULT_BUDGETS,
    writePolicy: opts.writePolicy ?? 'ask',
    snapshotOrder: opts.snapshotOrder ?? -50,
    maxEntriesPerQuery: opts.maxEntriesPerQuery ?? 20,
  }
  apply(mock.ctx, config)
  return { dir, dbPath, mock, config, approval }
}

function teardown(mounted) {
  mounted.mock.dispose()
  rmSync(mounted.dir, { recursive: true, force: true })
}

test('Config schema：默认值齐备，覆盖生效（F4）', () => {
  const normalized = Config({})
  assert.equal(normalized.enabled, true)
  assert.equal(normalized.dbPath, '')
  assert.equal(normalized.writePolicy, 'ask')
  assert.equal(normalized.snapshotOrder, -50)
  assert.equal(normalized.maxEntriesPerQuery, 20)
  assert.deepEqual(normalized.budgets, DEFAULT_BUDGETS)
  const overridden = Config({ writePolicy: 'off', budgets: { user: { userGlobal: 100, workspace: 100 }, agent: { userGlobal: 100, workspace: 100 } } })
  assert.equal(overridden.writePolicy, 'off')
  assert.equal(overridden.budgets.user.userGlobal, 100)
})

test('F1/F5/F6 注册面：ctx.memory 服务、memory 工具、快照段、审批 answerer 齐备', (t) => {
  const mounted = mount()
  t.after(() => teardown(mounted))
  const { mock } = mounted
  assert.ok(mock.services.get('memory') instanceof MemoryService)
  assert.ok(mock.tools.some((tool) => tool.name === 'memory'))
  const section = mock.sections.find((s) => s.name === 'dsh-memento:memory')
  assert.ok(section)
  assert.equal(section.order, -50)
  const answerers = mock.listeners.get('approval/request') ?? []
  assert.equal(answerers.length, 1)
  // 无 agent 的裸 assemble 不产快照（不报错）
  assert.equal(section.text({}), '')
})

test('S3：直接调 ctx.memory 服务（不经工具）仍被审批门拦截——off 策略拒绝且零落盘', async (t) => {
  const mounted = mount({ writePolicy: 'off' })
  t.after(() => teardown(mounted))
  const service = mounted.mock.services.get('memory')
  const session = makeSession()
  await assert.rejects(
    () => service.add({ track: 'user', scope: 'workspace', text: '不该落盘' }, { agent: makeAgent(session) }),
    (error) => error instanceof WriteDeniedError && error.details.outcome === 'rejected',
  )
  assert.equal(service.query({}).total, 0, '拒绝后条目必须不存在')
  assert.equal(mounted.approval.asked.length, 1, '审批门被咨询过（服务层强制）')
  assert.equal(mounted.approval.asked[0].toolName, 'memory')
  assert.ok(mounted.approval.asked[0].reason.startsWith('[dsh-memento]'))
  // 审计表记录拒绝来源可重建
  const audit = mounted.mock.services.get('memory').store.auditList()
  assert.equal(audit.length, 0, '未放行不写审计行；拒绝由 approval/decided 审计对记录')
})

test('S3：ask 策略下服务直写，人类 answerer 批准 → 落盘；拒绝 → 不落盘', async (t) => {
  const mounted = mount({ writePolicy: 'ask' })
  t.after(() => teardown(mounted))
  const { mock } = mounted
  const service = mock.services.get('memory')
  // 模拟人类 answerer：在链尾挂一个（ask 策略下本插件 answerer 委托续链）
  let human = 'rejected'
  mock.listeners.get('approval/request').push({
    fn: async (_req, next) => {
      if (human === 'allowed-once') return 'allowed-once'
      return next()
    },
  })
  const session = makeSession()
  const write = { agent: makeAgent(session) }
  await assert.rejects(
    () => service.add({ track: 'user', scope: 'user-global', text: '偏好中文' }, write),
    (error) => error instanceof WriteDeniedError && error.details.outcome === 'unavailable',
  )
  assert.equal(service.query({}).total, 0)
  human = 'allowed-once'
  const result = await service.add({ track: 'user', scope: 'user-global', text: '偏好中文' }, write)
  assert.ok(result.entry.id)
  assert.equal(service.query({}).total, 1)
})

test('F8：auto 策略下服务直写经 answerer 自动放行并记录审批来源', async (t) => {
  const mounted = mount({ writePolicy: 'auto' })
  t.after(() => teardown(mounted))
  const { mock } = mounted
  const service = mock.services.get('memory')
  const result = await service.add(
    { track: 'agent', scope: 'workspace', text: '项目约定：测试先于实现' },
    { agent: makeAgent(makeSession()) },
  )
  assert.ok(result.entry.id)
  const audit = service.store.auditList()
  assert.equal(audit[0].action, 'add')
  assert.equal(audit[0].outcome, 'allowed-once (via approval, writePolicy auto)', '审计行记录真实裁决来源=审批传输+auto 策略')
  // 审批审计对也记录了放行（bus 派发路径）
  assert.equal(mounted.approval.asked.length, 1)
})

test('F3/F5：写满返回结构化超限错误（含用量与上限），模型整合删除后重试成功', async (t) => {
  const mounted = mount({
    writePolicy: 'auto',
    budgets: {
      user: { userGlobal: 12, workspace: 12 },
      agent: { userGlobal: 100, workspace: 100 },
    },
  })
  t.after(() => teardown(mounted))
  const { mock } = mounted
  const service = mock.services.get('memory')
  const session = makeSession()
  const write = { agent: makeAgent(session) }
  await service.add({ track: 'user', scope: 'user-global', text: 'abcdefghijkl' }, write) // 12/12 满
  await assert.rejects(
    () => service.add({ track: 'user', scope: 'user-global', text: 'oops' }, write),
    (error) => error instanceof BudgetExceededError
      && error.details.used === 12
      && error.details.limit === 12
      && error.details.needed === 16,
  )
  assert.equal(service.query({ track: 'user', scope: 'user-global' }).total, 1, '超限写不落盘')
  // 工具层：ok:false + 结构化 error（模型整合入口）
  const tool = mock.tools.find((t) => t.name === 'memory')
  const exec = makeExec({ agent: makeAgent(makeSession()) })
  const toolResult = await tool.execute({ action: 'add', track: 'user', scope: 'user-global', text: 'oops' }, exec)
  assert.equal(toolResult.ok, false)
  assert.equal(toolResult.error.code, 'BUDGET_EXCEEDED')
  assert.deepEqual(toolResult.error.usage, { track: 'user', scope: 'user-global', used: 12, limit: 12 })
  // 模型整合：删一条 → 重试成功
  await service.remove({ track: 'user', scope: 'user-global', match: 'abcd' }, write)
  const retry = await service.add({ track: 'user', scope: 'user-global', text: '整合后' }, write)
  assert.ok(retry.entry.id)
  assert.equal(retry.usage.used, 3)
})

test('F2：replace/remove 唯一子串——歧义报错给候选，要求更具体', async (t) => {
  const mounted = mount({ writePolicy: 'auto' })
  t.after(() => teardown(mounted))
  const { mock } = mounted
  const service = mock.services.get('memory')
  const write = { agent: makeAgent(makeSession()) }
  await service.add({ track: 'user', scope: 'user-global', text: '偏好中文回复' }, write)
  await service.add({ track: 'user', scope: 'user-global', text: '偏好中文注释' }, write)
  await assert.rejects(
    () => service.replace({ track: 'user', scope: 'user-global', match: '偏好中文', text: 'x' }, write),
    (error) => error instanceof MemoryError && error.code === 'AMBIGUOUS_MATCH' && error.details.candidates === 2,
  )
  const replaced = await service.replace({ track: 'user', scope: 'user-global', match: '注释', text: '偏好英文注释' }, write)
  assert.equal(replaced.entry.text, '偏好英文注释')
  assert.equal(replaced.previous.text, '偏好中文注释')
  const removed = await service.remove({ track: 'user', scope: 'user-global', match: '中文回复' }, write)
  assert.equal(removed.entry.text, '偏好中文回复')
  assert.equal(service.query({ track: 'user', scope: 'user-global' }).total, 1)
})

test('P0-4：replace 审批期间并发新增填满预算 → 复审以此刻用量拒绝，零落盘', async (t) => {
  const mounted = mount({
    writePolicy: 'ask',
    budgets: { user: { userGlobal: 10, workspace: 10 }, agent: { userGlobal: 10, workspace: 10 } },
  })
  t.after(() => teardown(mounted))
  const { mock } = mounted
  const service = mock.services.get('memory')
  const write = { agent: makeAgent(makeSession()) }
  // 人类 answerer 先注册（setup 阶段的 add 需要它放行）；审批等待期间的并发写经 duringAsk 注入。
  let duringAsk = null
  mock.listeners.get('approval/request').push({
    fn: async () => {
      if (duringAsk !== null) duringAsk()
      return 'allowed-once'
    },
  })
  await service.add({ track: 'user', scope: 'workspace', text: 'ab' }, write)
  await service.add({ track: 'user', scope: 'workspace', text: 'cd' }, write)
  duringAsk = () => service.store.insertEntry({ track: 'user', scope: 'workspace', text: 'zzzzzzzz' })
  // 预检：used 4 + net 6 = 10 ≤ 10 通过；并发后 used 12 + net 6 = 18 → 复审响亮拒绝
  await assert.rejects(
    () => service.replace({ track: 'user', scope: 'workspace', match: 'ab', text: 'abcdefgh' }, write),
    (error) => error instanceof BudgetExceededError && error.details.used === 12 && error.details.needed === 18,
  )
  assert.equal(service.query({ track: 'user', scope: 'workspace', text: 'ab' }).total, 1, '目标条目未被替换')
})

test('P0-4：replace 审批期间目标被并发改写 → 复审以重新定位的 previous 为权威', async (t) => {
  const mounted = mount({
    writePolicy: 'ask',
    budgets: { user: { userGlobal: 10, workspace: 10 }, agent: { userGlobal: 10, workspace: 10 } },
  })
  t.after(() => teardown(mounted))
  const { mock } = mounted
  const service = mock.services.get('memory')
  const write = { agent: makeAgent(makeSession()) }
  let duringAsk = null
  mock.listeners.get('approval/request').push({
    fn: async () => {
      if (duringAsk !== null) duringAsk()
      return 'allowed-once'
    },
  })
  await service.add({ track: 'user', scope: 'workspace', text: 'ab' }, write)
  await service.add({ track: 'user', scope: 'workspace', text: 'cd' }, write)
  // 并发改写：目标仍包含原 match 但长度变化（ab → xabx），复审必须以新 previous 重算净变化
  duringAsk = () => service.store.replaceEntry({ track: 'user', scope: 'workspace', match: 'ab', text: 'xabx', sessionId: 'concurrent' })
  const replaced = await service.replace({ track: 'user', scope: 'workspace', match: 'ab', text: 'abcdefgh' }, write)
  assert.equal(replaced.previous.text, 'xabx', 'previous 是审批后重新定位的结果，而非审批前的陈旧值')
  assert.equal(replaced.entry.text, 'abcdefgh')
  assert.equal(service.store.usage('user', 'workspace'), 10, 'cd(2) + abcdefgh(8)；xabx 已被替换')

  // 并发移除目标 → 复审重新定位响亮报错，绝不静默（换 agent 轨避免 user/workspace 已满）
  await service.add({ track: 'agent', scope: 'workspace', text: 'ef' }, write)
  duringAsk = () => service.store.removeEntry({ track: 'agent', scope: 'workspace', match: 'ef' })
  await assert.rejects(
    () => service.replace({ track: 'agent', scope: 'workspace', match: 'ef', text: 'efgh' }, write),
    (error) => error instanceof EntryNotFoundError,
  )
})

test('F6+S2：冻结快照——会话内变更不更新注入；注入文本与 snapshot 审计逐字一致（可重建）', async (t) => {
  const mounted = mount({ writePolicy: 'auto' })
  t.after(() => teardown(mounted))
  const { mock } = mounted
  const service = mock.services.get('memory')
  const section = mock.sections.find((s) => s.name === 'dsh-memento:memory')

  const sessionA = makeSession({ id: 'session-a' })
  await service.add({ track: 'user', scope: 'user-global', text: '偏好中文回复' }, { agent: makeAgent(sessionA) })

  const first = section.text({ agent: { session: sessionA } })
  assert.ok(first.includes('偏好中文回复'), '快照包含已批准条目')
  assert.ok(first.includes('/2000 chars used'), '快照带用量头')

  // 会话内变更：只落盘+审计，不更新已注入快照（前缀缓存稳定）
  await service.add({ track: 'user', scope: 'user-global', text: '追加的新偏好' }, { agent: makeAgent(sessionA) })
  assert.equal(section.text({ agent: { session: sessionA } }), first, '冻结：同一会话第二次 assemble 与首次逐字一致')

  // S2：注入内容与 snapshot 审计记录一致 → 可自日志重建
  const snapshotAudit = service.store.auditList().filter((row) => row.action === 'snapshot')
  assert.equal(snapshotAudit.length, 1)
  assert.equal(snapshotAudit[0].text, first, '模型所见快照 == 审计落盘的快照文本')
  assert.equal(snapshotAudit[0].sessionId, 'session-a')

  // 新会话（同工作区）读到含新条目的快照
  const sessionB = makeSession({ id: 'session-b' })
  const second = section.text({ agent: { session: sessionB } })
  assert.ok(second.includes('追加的新偏好'), '新会话快照包含本会话前的全部条目')
  assert.notEqual(second, first)
})

test('S2：审批 reason 可无损重建写变更（approval/asked 审计对路径）', async (t) => {
  const mounted = mount({ writePolicy: 'auto' })
  t.after(() => teardown(mounted))
  const { mock } = mounted
  const service = mock.services.get('memory')
  await service.add(
    { track: 'user', scope: 'workspace', text: '第二行\n第三行' },
    { agent: makeAgent(makeSession({ id: 's-rebuild' })) },
  )
  const asked = mounted.approval.asked[0]
  const parsed = parseWriteReason(asked.reason)
  assert.deepEqual(parsed, { action: 'add', track: 'user', scope: 'workspace', text: '第二行\n第三行' })
  assert.equal(asked.toolName, 'memory')
})

test('F6：workspace 层按会话 cwd 隔离，user-global 跨工作区可见', async (t) => {
  const mounted = mount({ writePolicy: 'auto' })
  t.after(() => teardown(mounted))
  const { mock } = mounted
  const service = mock.services.get('memory')
  const section = mock.sections.find((s) => s.name === 'dsh-memento:memory')

  const ws1 = makeSession({ id: 'ws1', cwd: 'C:\\work\\proj-a' })
  const ws2 = makeSession({ id: 'ws2', cwd: 'C:\\work\\proj-b' })
  await service.add({ track: 'agent', scope: 'workspace', text: '项目A约定' }, { agent: makeAgent(ws1) })
  await service.add({ track: 'user', scope: 'user-global', text: '全局偏好' }, { agent: makeAgent(ws1) })

  const textA = section.text({ agent: { session: ws1 } })
  const textB = section.text({ agent: { session: ws2 } })
  assert.ok(textA.includes('项目A约定'))
  assert.ok(!textB.includes('项目A约定'), '其它工作区看不到该项目约定')
  assert.ok(textB.includes('全局偏好'), 'user-global 跨工作区可见')
})

test('S3：enabled:false 时工具、注入、服务、answerer 整体消失且不建库', (t) => {
  const mounted = mount({ enabled: false })
  t.after(() => teardown(mounted))
  const { mock, dbPath } = mounted
  assert.equal(mock.services.get('memory'), undefined)
  assert.equal(mock.tools.some((tool) => tool.name === 'memory'), false)
  assert.equal(mock.sections.some((s) => s.name === 'dsh-memento:memory'), false)
  assert.equal(mock.listeners.has('approval/request'), false)
  assert.equal(existsSync(dbPath), false, '禁用时不触碰数据库')
})

test('effect 撤回：dispose 后服务消失、库关闭（不留半残状态）', (t) => {
  const mounted = mount({ writePolicy: 'auto' })
  const { mock } = mounted
  const service = mock.services.get('memory')
  assert.ok(service)
  mock.dispose()
  assert.equal(mock.services.get('memory'), undefined)
  assert.throws(() => service.store.insertEntry({ track: 'user', scope: 'workspace', text: 'x' }), /database is (not open|closed)/)
  rmSync(mounted.dir, { recursive: true, force: true })
})

test('F5：工具 execute 返回规范 JSON，render 是纯函数且尊重 signal', async (t) => {
  const mounted = mount({ writePolicy: 'auto' })
  t.after(() => teardown(mounted))
  const { mock } = mounted
  const tool = mock.tools.find((t) => t.name === 'memory')

  const addResult = await tool.execute(
    { action: 'add', track: 'agent', scope: 'workspace', text: '教训：先备份再迁移' },
    makeExec({ agent: makeAgent(makeSession({ id: 's-tool' })) }),
  )
  assert.equal(addResult.ok, true)
  assert.equal(addResult.action, 'add')
  assert.ok(addResult.entry.id)
  assert.deepEqual(Object.keys(addResult.usage).sort(), ['limit', 'scope', 'track', 'used'])

  const queryResult = await tool.execute(
    { action: 'query', text: '备份' },
    makeExec({ agent: makeAgent(makeSession()) }),
  )
  assert.equal(queryResult.ok, true)
  assert.equal(queryResult.entries.length, 1)
  assert.equal(queryResult.total, 1)
  assert.equal(queryResult.truncated, false)

  // render 纯函数：同输入同输出
  const renderedAdd = renderMemoryResult({}, addResult)
  assert.deepEqual(renderedAdd, renderMemoryResult({}, structuredClone(addResult)))
  assert.ok(renderedAdd[0].text.includes('教训：先备份再迁移'))

  // 已中止的 exec：execute 抛 abort（基础设施失败 → isError，不做半写）
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  await assert.rejects(
    () => tool.execute({ action: 'add', track: 'user', scope: 'workspace', text: 'x' }, makeExec({ controller })),
    /cancelled/,
  )

  // 无 agent 的写：失败封闭（结构化 NO_AGENT），不抛基础设施错误
  const noAgent = await tool.execute(
    { action: 'add', track: 'user', scope: 'workspace', text: 'x' },
    makeExec({ agent: undefined }),
  )
  assert.equal(noAgent.ok, false)
  assert.equal(noAgent.error.code, 'WRITE_REQUIRES_AGENT')
})

test('F12：seed 一次 ask 批量落盘；超预算整批拒绝零部分写入', async (t) => {
  const mounted = mount({
    writePolicy: 'auto',
    budgets: {
      user: { userGlobal: 100, workspace: 100 },
      agent: { userGlobal: 10, workspace: 10 },
    },
  })
  t.after(() => teardown(mounted))
  const { mock } = mounted
  const service = mock.services.get('memory')
  const write = { agent: makeAgent(makeSession({ id: 's-seed' })) }

  const ok = await service.seed([
    { track: 'agent', scope: 'workspace', text: 'aa', source: 'claude' },
    { track: 'agent', scope: 'workspace', text: 'bbb', source: 'claude' },
  ], write)
  assert.equal(ok.added, 2)
  assert.equal(mounted.approval.asked.length, 1, '整个批次只 ask 一次')
  const parsed = parseWriteReason(mounted.approval.asked[0].reason)
  assert.equal(parsed.count, 2)
  assert.equal(service.query({ track: 'agent', scope: 'workspace' }).total, 2)

  await assert.rejects(
    () => service.seed([
      { track: 'agent', scope: 'workspace', text: 'ccccccccc' },
      { track: 'agent', scope: 'workspace', text: 'dd' },
    ], write),
    (error) => error instanceof BudgetExceededError,
  )
  assert.equal(service.query({ track: 'agent', scope: 'workspace' }).total, 2, '超限批次零部分写入')
})

test('consolidate：一次审批整合多条；预算净变化；拒绝零落盘', async (t) => {
  const mounted = mount({ writePolicy: 'auto' })
  t.after(() => teardown(mounted))
  const { mock } = mounted
  const service = mock.services.get('memory')
  const write = { agent: makeAgent(makeSession({ id: 's-cons' })) }
  await service.add({ track: 'user', scope: 'user-global', text: '偏好中文回复' }, write)
  await service.add({ track: 'user', scope: 'user-global', text: '偏好中文注释' }, write)
  const asksBefore = mounted.approval.asked.length

  const result = await service.consolidate(
    { track: 'user', scope: 'user-global', matches: ['回复', '注释'], text: '偏好中文风格（整合）', source: 'memory-tool' },
    write,
  )
  assert.equal(result.removed.length, 2)
  assert.equal(result.entry.text, '偏好中文风格（整合）')
  assert.equal(mounted.approval.asked.length, asksBefore + 1, '整个整合方案只 ask 一次')
  assert.equal(parseWriteReason(mounted.approval.asked.at(-1).reason).action, 'consolidate')
  assert.equal(service.query({ track: 'user', scope: 'user-global' }).total, 1)
  const auditActions = service.store.auditList().slice(0, 3).map((row) => row.action)
  assert.deepEqual(auditActions, ['consolidate-add', 'consolidate-remove', 'consolidate-remove'], '审计逐条记录 add/remove，同一 outcome')

  // 歧义在审批前响亮失败，零 ask 零落盘
  await service.add({ track: 'user', scope: 'user-global', text: '偏好中文回复A' }, write)
  await service.add({ track: 'user', scope: 'user-global', text: '偏好中文回复B' }, write)
  const asksAmbiguous = mounted.approval.asked.length
  await assert.rejects(
    () => service.consolidate({ track: 'user', scope: 'user-global', matches: ['偏好中文回复'], text: 'x' }, write),
    (error) => error instanceof AmbiguousMatchError,
  )
  assert.equal(mounted.approval.asked.length, asksAmbiguous, '歧义不打扰用户')
  assert.equal(service.query({ track: 'user', scope: 'user-global' }).total, 3)
})

test('consolidate：off 策略拒绝时零落盘', async (t) => {
  const mounted = mount({ writePolicy: 'off' })
  t.after(() => teardown(mounted))
  const service = mounted.mock.services.get('memory')
  await assert.rejects(
    () => service.consolidate({ track: 'user', scope: 'workspace', matches: ['不存在'], text: 'x' }, { agent: makeAgent(makeSession()) }),
    (error) => error instanceof EntryNotFoundError,
  )
  assert.equal(service.query({}).total, 0, '目标不存在即失败，任何情况都不落盘')
})

test('S5：无 agent 的服务直写失败封闭（不产生任何写/审计）', async (t) => {
  const mounted = mount({ writePolicy: 'auto' })
  t.after(() => teardown(mounted))
  const service = mounted.mock.services.get('memory')
  await assert.rejects(
    () => service.add({ track: 'user', scope: 'workspace', text: 'x' }, {}),
    (error) => error instanceof NoAgentError,
  )
  assert.equal(service.query({}).total, 0)
  assert.equal(mounted.approval.asked.length, 0)
})

test('S5：非法配置在加载期响亮失败（不注册半残状态）', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-memento-it-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const mk = () => createMockCtx({ approval: makeBusApproval(null) })
  assert.throws(
    () => apply(mk().ctx, { dbPath: path.join(dir, 'm.db'), budgets: { user: { userGlobal: 0, workspace: 1 }, agent: { userGlobal: 1, workspace: 1 } } }),
    InvalidInputError,
  )
  assert.throws(
    () => apply(mk().ctx, { dbPath: path.join(dir, 'm.db'), writePolicy: 'maybe' }),
    InvalidInputError,
  )
  assert.throws(
    () => apply(mk().ctx, { dbPath: path.join(dir, 'm.db'), snapshotOrder: Number.NaN }),
    InvalidInputError,
  )
  assert.throws(
    () => apply(mk().ctx, { dbPath: path.join(dir, 'm.db'), commandListLimit: 0 }),
    InvalidInputError,
  )
  assert.throws(
    () => apply(mk().ctx, { dbPath: path.join(dir, 'm.db'), commandAuditLimit: -1 }),
    InvalidInputError,
  )
  assert.throws(
    () => apply(mk().ctx, { dbPath: path.join(dir, 'm.db'), recall: { historyLimitDefault: 0 } }),
    InvalidInputError,
  )
  assert.throws(
    () => apply(mk().ctx, { dbPath: path.join(dir, 'm.db'), recall: { snippetCap: 1.5 } }),
    InvalidInputError,
  )
  assert.throws(
    () => apply(mk().ctx, { dbPath: path.join(dir, 'm.db'), panelEntriesLimit: 0 }),
    InvalidInputError,
  )
  assert.throws(
    () => apply(mk().ctx, { dbPath: path.join(dir, 'm.db'), panelAuditLimit: 0 }),
    InvalidInputError,
  )
  assert.throws(
    () => apply(mk().ctx, { dbPath: path.join(dir, 'm.db'), auditRetentionDays: -1 }),
    InvalidInputError,
  )
})

test('rc.6 安全线：memory/* 未被 harness 收录时不向会话日志 append（防持久化拒绝）', async (t) => {
  const mounted = mount({ writePolicy: 'auto' })
  t.after(() => teardown(mounted))
  const service = mounted.mock.services.get('memory')
  const session = makeSession({ id: 's-events' })
  await service.add({ track: 'user', scope: 'user-global', text: 'x' }, { agent: makeAgent(session) })
  const section = mounted.mock.sections.find((s) => s.name === 'dsh-memento:memory')
  section.text({ agent: { session } })
  const types = session.events.map((event) => event.type)
  assert.equal(types.some((type) => type.startsWith('memory/')), false, '未注册类型绝不 append（否则会话下次加载被持久化层拒绝）')
})

test('memory/recalled：query 带 session 时按已知类型自适应派发（未收录跳过，收录后开启）', async (t) => {
  const mounted = mount({ writePolicy: 'auto' })
  t.after(() => teardown(mounted))
  const service = mounted.mock.services.get('memory')
  const session = makeSession({ id: 's-recall' })
  await service.add({ track: 'user', scope: 'user-global', text: '召回目标条目' }, { agent: makeAgent(session) })

  // 未收录：query 不向会话日志 append（与写路径同一安全线）
  service.query({ text: '召回' }, { sessionId: 's-recall', session })
  assert.equal(session.events.some((event) => event.type === 'memory/recalled'), false)

  // 模拟 harness 收录：自适应门打开后同路径 append，载荷与 SessionEventMap 声明一致
  KNOWN_SESSION_EVENT_TYPES.add('memory/recalled')
  t.after(() => KNOWN_SESSION_EVENT_TYPES.delete('memory/recalled'))
  service.query({ text: '召回' }, { sessionId: 's-recall', session })
  const recalled = session.events.filter((event) => event.type === 'memory/recalled')
  assert.equal(recalled.length, 1)
  assert.deepEqual(recalled[0].data, { query: '召回', matches: 1, sessionId: 's-recall' })
  // 工具路径同样传递 session（收录状态下经工具 query 也会派发）
  const tool = mounted.mock.tools.find((t) => t.name === 'memory')
  await tool.execute({ action: 'query', text: '召回' }, makeExec({ agent: makeAgent(session) }))
  assert.equal(session.events.filter((event) => event.type === 'memory/recalled').length, 2)
})
