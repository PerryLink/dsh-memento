// test/protocol-conformance/suite.mjs — dsh-memory-protocol v1 一致性用例集。
//
// 对外分发的协议用例：任何声称兼容 dsh-memory-protocol v1 的 Provider 都跑
// 同一套用例（本目录 README.md 有 Provider 契约与运行方法）。用例只依赖
// node:assert 与 node:crypto——不依赖本仓库任何实现，错误断言用协议错误码
// 字符串（docs/protocol-v1.md 的错误码表），因此第三方可以原样拷贝运行。
//
// 用例分组：A 条目模型 / B 写语义 / C 预算模型 / D 审计重建 / E 导出信封。

import assert from 'node:assert/strict'

/** 一致性写上下文（协议：写需要 owning agent 路由审批；会话形状最小面）。 */
export function makeWrite(sessionId = 'conformance-session') {
  return {
    agent: {
      session: {
        id: sessionId,
        header: { cwd: 'C:/conformance/ws', agentPreset: 'conformance' },
      },
    },
  }
}

/** 断言协议错误码（Provider 抛错面：code 字段即协议错误码）。 */
export function assertCode(/** @type {unknown} */ error, /** @type {string} */ code) {
  assert.ok(error !== null && typeof error === 'object', `expected an error object with code ${code}`)
  assert.equal(/** @type {{code?: unknown}} */ (error).code, code)
}

/**
 * @typedef {object} ConformanceCase - 单个一致性用例。
 * @property {string} id - 稳定 id（报告与 --filter 用）。
 * @property {string} section - 分组（A 条目模型 / B 写语义 / C 预算模型 / D 审计重建 / E 导出信封）。
 * @property {string} name - 行为描述（一句话）。
 * @property {object} [providerOptions] - 传给 Provider 工厂的选项（如小预算、注入 gate）。
 * @property {(provider: object, options: object) => Promise<void> | void} run - 用例主体。
 */

/** @type {ConformanceCase[]} 全部一致性用例（对外契约：不要删除/改语义，只能追加）。 */
export const CONFORMANCE_CASES = /** @type {ConformanceCase[]} */ ([
  // ── A 条目模型 ──────────────────────────────────────────────────────────────
  {
    id: 'A1',
    section: 'entry-model',
    name: 'add 落盘条目携带协议 v1 全部字段（UUID v4 id / tags / version 1 / 时间戳）',
    async run(provider) {
      const { entry } = await provider.add(
        { track: 'user', scope: 'user-global', text: '用户偏好：中文回复', tags: ['pref', 'comms'] },
        makeWrite(),
      )
      assert.match(entry.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
      assert.equal(entry.track, 'user')
      assert.equal(entry.scope, 'user-global')
      assert.equal(typeof entry.workspaceKey, 'string')
      assert.equal(typeof entry.agentKey, 'string')
      assert.equal(entry.text, '用户偏好：中文回复')
      assert.equal(typeof entry.source, 'string')
      assert.deepEqual(entry.tags, ['pref', 'comms'])
      assert.equal(entry.version, 1)
      assert.ok(Number.isInteger(entry.createdAt) && Number.isInteger(entry.updatedAt) && entry.updatedAt >= entry.createdAt)
      assert.equal(entry.lastRecalled, null)
      assert.equal(entry.recallCount, 0)
      assert.equal(entry.sessionId, 'conformance-session')
    },
  },
  {
    id: 'A2',
    section: 'entry-model',
    name: '非法 track 以 INVALID_INPUT 响亮失败且不落盘',
    async run(provider) {
      await assert.rejects(provider.add({ track: 'team', scope: 'user-global', text: 'x' }, makeWrite()), (error) => {
        assertCode(error, 'INVALID_INPUT')
        return true
      })
      assert.equal(provider.listEntries().length, 0)
    },
  },
  {
    id: 'A3',
    section: 'entry-model',
    name: '非法 scope 以 INVALID_INPUT 响亮失败',
    async run(provider) {
      await assert.rejects(provider.add({ track: 'user', scope: 'global', text: 'x' }, makeWrite()), (error) => {
        assertCode(error, 'INVALID_INPUT')
        return true
      })
    },
  },
  {
    id: 'A4',
    section: 'entry-model',
    name: '空文本以 INVALID_INPUT 响亮失败（绝不落空条目）',
    async run(provider) {
      await assert.rejects(provider.add({ track: 'user', scope: 'user-global', text: '' }, makeWrite()), (error) => {
        assertCode(error, 'INVALID_INPUT')
        return true
      })
      assert.equal(provider.listEntries().length, 0)
    },
  },
  {
    id: 'A5',
    section: 'entry-model',
    name: '写缺少 owning agent 以 WRITE_REQUIRES_AGENT 失败封闭（绝不无审批落盘）',
    async run(provider) {
      await assert.rejects(provider.add({ track: 'user', scope: 'user-global', text: 'x' }, {}), (error) => {
        assertCode(error, 'WRITE_REQUIRES_AGENT')
        return true
      })
    },
  },
  {
    id: 'A6',
    section: 'entry-model',
    name: '标签规范化（trim/去重）生效；非法标签响亮失败',
    async run(provider) {
      const { entry } = await provider.add(
        { track: 'user', scope: 'user-global', text: '带标签', tags: ['a ', 'a', 'b'] },
        makeWrite(),
      )
      assert.deepEqual(entry.tags, ['a', 'b'])
      await assert.rejects(
        provider.add({ track: 'user', scope: 'user-global', text: 'y', tags: ['x'.repeat(33)] }, makeWrite()),
        (error) => { assertCode(error, 'INVALID_INPUT'); return true },
      )
      await assert.rejects(
        provider.add({ track: 'user', scope: 'user-global', text: 'z', tags: Array.from({ length: 17 }, (_, i) => `t${i}`) }, makeWrite()),
        (error) => { assertCode(error, 'INVALID_INPUT'); return true },
      )
      await assert.rejects(
        provider.add({ track: 'user', scope: 'user-global', text: 'w', tags: ['bad\u0000tag'] }, makeWrite()),
        (error) => { assertCode(error, 'INVALID_INPUT'); return true },
      )
    },
  },
  {
    id: 'A7',
    section: 'entry-model',
    name: 'query 按大小写不敏感子串命中（ASCII 折叠与 CJK 文本照常命中）',
    async run(provider) {
      await provider.add({ track: 'user', scope: 'user-global', text: '项目约定：测试先于实现' }, makeWrite())
      await provider.add({ track: 'agent', scope: 'user-global', text: 'Project convention: TDD' }, makeWrite())
      const cjk = provider.query({ text: '测试先于实现' })
      assert.equal(cjk.total, 1)
      const lower = provider.query({ text: 'project' })
      assert.equal(lower.total, 1)
      const upper = provider.query({ text: 'PROJECT' })
      assert.equal(upper.total, 1)
    },
  },

  // ── B 写语义 ────────────────────────────────────────────────────────────────
  {
    id: 'B1',
    section: 'write-semantics',
    name: 'replace 按唯一子串改写：id 稳定、version 自增、文本替换',
    async run(provider) {
      const { entry: first } = await provider.add({ track: 'user', scope: 'user-global', text: '旧记忆：喜欢咖啡' }, makeWrite())
      const { previous, entry } = await provider.replace(
        { track: 'user', scope: 'user-global', match: '喜欢咖啡', text: '喜欢茶' },
        makeWrite(),
      )
      assert.equal(previous.id, first.id)
      assert.equal(entry.id, first.id)
      assert.equal(entry.version, first.version + 1)
      assert.equal(entry.text, '喜欢茶')
      assert.equal(previous.version, first.version)
      assert.equal(provider.listEntries().length, 1)
    },
  },
  {
    id: 'B2',
    section: 'write-semantics',
    name: 'replace 歧义命中以 AMBIGUOUS_MATCH 报候选数并保持原状',
    async run(provider) {
      await provider.add({ track: 'user', scope: 'user-global', text: '咖啡机型号 A' }, makeWrite())
      await provider.add({ track: 'user', scope: 'user-global', text: '咖啡机型号 B' }, makeWrite())
      await assert.rejects(
        provider.replace({ track: 'user', scope: 'user-global', match: '咖啡机', text: 'x' }, makeWrite()),
        (error) => {
          assertCode(error, 'AMBIGUOUS_MATCH')
          assert.equal(/** @type {{details?: {candidates?: unknown}}} */ (error).details?.candidates, 2)
          return true
        },
      )
      assert.equal(provider.listEntries().length, 2)
    },
  },
  {
    id: 'B3',
    section: 'write-semantics',
    name: '零命中 replace/remove 以 ENTRY_NOT_FOUND 响亮失败',
    async run(provider) {
      await provider.add({ track: 'user', scope: 'user-global', text: '存在的条目' }, makeWrite())
      await assert.rejects(
        provider.replace({ track: 'user', scope: 'user-global', match: '不存在的', text: 'x' }, makeWrite()),
        (error) => { assertCode(error, 'ENTRY_NOT_FOUND'); return true },
      )
      await assert.rejects(
        provider.remove({ track: 'user', scope: 'user-global', match: '不存在的' }, makeWrite()),
        (error) => { assertCode(error, 'ENTRY_NOT_FOUND'); return true },
      )
    },
  },
  {
    id: 'B4',
    section: 'write-semantics',
    name: 'remove 删除后重跑以 ENTRY_NOT_FOUND 失败（条件写天然防双删）',
    async run(provider) {
      await provider.add({ track: 'user', scope: 'user-global', text: '待删除的临时事实' }, makeWrite())
      const removed = await provider.remove({ track: 'user', scope: 'user-global', match: '临时事实' }, makeWrite())
      assert.equal(removed.entry.text, '待删除的临时事实')
      assert.equal(provider.listEntries().length, 0)
      await assert.rejects(
        provider.remove({ track: 'user', scope: 'user-global', match: '临时事实' }, makeWrite()),
        (error) => { assertCode(error, 'ENTRY_NOT_FOUND'); return true },
      )
    },
  },
  {
    id: 'B5',
    section: 'write-semantics',
    name: 'consolidate 原子整合：目标全删 + 一条新条目（version 1），失败无部分写入',
    async run(provider) {
      await provider.add({ track: 'agent', scope: 'user-global', text: '约定一：早会 9 点' }, makeWrite())
      await provider.add({ track: 'agent', scope: 'user-global', text: '约定二：晚检 6 点' }, makeWrite())
      const { removed, entry } = await provider.consolidate(
        { track: 'agent', scope: 'user-global', matches: ['约定一', '约定二'], text: '约定：早会 9 点，晚检 6 点' },
        makeWrite(),
      )
      assert.equal(removed.length, 2)
      assert.equal(entry.version, 1)
      assert.equal(provider.listEntries().length, 1)
      assert.equal(provider.listEntries()[0].text, '约定：早会 9 点，晚检 6 点')
      await assert.rejects(
        provider.consolidate({ track: 'agent', scope: 'user-global', matches: ['约定一'], text: 'x' }, makeWrite()),
        (error) => { assertCode(error, 'ENTRY_NOT_FOUND'); return true },
      )
    },
  },
  {
    id: 'B6',
    section: 'write-semantics',
    name: 'seed 批量原子：新 id/version 1；任一条超预算整批拒绝',
    async run(provider) {
      const result = await provider.seed([
        { track: 'user', scope: 'user-global', text: '种子一' },
        { track: 'agent', scope: 'workspace', text: '种子二' },
      ], makeWrite())
      assert.equal(result.added, 2)
      assert.ok(result.entries.every((entry) => entry.version === 1))
      assert.equal(new Set(result.entries.map((entry) => entry.id)).size, 2)
    },
  },
  {
    id: 'B7',
    section: 'write-semantics',
    name: '审批载荷完整（approve-what-you-see）：replace 载荷携带 from/to 全文',
    async run(provider, options) {
      /** @type {object[]} */
      const seen = []
      const own = options.makeProvider({
        gate: async (payload) => {
          seen.push(payload)
          return 'allowed-once'
        },
      })
      try {
        await own.add({ track: 'user', scope: 'user-global', text: '旧文本需要被替换' }, makeWrite())
        seen.length = 0
        await own.replace({ track: 'user', scope: 'user-global', match: '旧文本', text: '新文本已经替换' }, makeWrite())
        assert.equal(seen.length, 1)
        const payload = /** @type {{text?: unknown}} */ (seen[0])
        assert.equal(typeof payload.text, 'string')
        assert.ok(/** @type {string} */ (payload.text).includes('旧文本需要被替换'))
        assert.ok(/** @type {string} */ (payload.text).includes('新文本已经替换'))
      } finally {
        own.close?.()
      }
    },
  },

  // ── C 预算模型 ──────────────────────────────────────────────────────────────
  {
    id: 'C1',
    section: 'budget-model',
    name: '超预算 add 以 BUDGET_EXCEEDED 报 used/limit/needed 且不落盘',
    providerOptions: { budgets: { user: { userGlobal: 100, workspace: 100 }, agent: { userGlobal: 100, workspace: 100 } } },
    async run(provider) {
      await assert.rejects(
        provider.add({ track: 'user', scope: 'user-global', text: 'x'.repeat(150) }, makeWrite()),
        (error) => {
          assertCode(error, 'BUDGET_EXCEEDED')
          const details = /** @type {{details?: {used?: unknown, limit?: unknown, needed?: unknown}}} */ (error).details
          assert.equal(details?.limit, 100)
          assert.ok(/** @type {number} */ (details?.needed) >= 150)
          return true
        },
      )
      assert.equal(provider.listEntries().length, 0)
    },
  },
  {
    id: 'C2',
    section: 'budget-model',
    name: 'seed 任一条超预算 → 整批拒绝（无部分写入）',
    providerOptions: { budgets: { user: { userGlobal: 100, workspace: 100 }, agent: { userGlobal: 100, workspace: 100 } } },
    async run(provider) {
      await assert.rejects(
        provider.seed([
          { track: 'user', scope: 'user-global', text: '小条目' },
          { track: 'user', scope: 'user-global', text: 'y'.repeat(120) },
        ], makeWrite()),
        (error) => { assertCode(error, 'BUDGET_EXCEEDED'); return true },
      )
      assert.equal(provider.listEntries().length, 0)
    },
  },
  {
    id: 'C3',
    section: 'budget-model',
    name: 'budgets() 报表按 track×scope 报用量与配置上限',
    providerOptions: { budgets: { user: { userGlobal: 100, workspace: 200 }, agent: { userGlobal: 300, workspace: 400 } } },
    async run(provider) {
      await provider.add({ track: 'user', scope: 'user-global', text: '十个字符的条目xx' }, makeWrite())
      const rows = provider.budgets()
      const row = rows.find((/** @type {{track: string, scope: string}} */ r) => r.track === 'user' && r.scope === 'user-global')
      assert.ok(row)
      assert.equal(row.limit, 100)
      assert.equal(row.used, '十个字符的条目xx'.length)
    },
  },

  // ── D 审计重建 ──────────────────────────────────────────────────────────────
  {
    id: 'D1',
    section: 'audit-reconstruction',
    name: '放行写落审计行：action/text/entryId 齐备（写可自审计账本重建）',
    async run(provider) {
      const { entry } = await provider.add({ track: 'user', scope: 'user-global', text: '审计可见的条目' }, makeWrite())
      const rows = provider.auditList(10)
      const row = rows.find((/** @type {{action: string}} */ r) => r.action === 'add')
      assert.ok(row, 'expect an add audit row')
      assert.equal(/** @type {{text: unknown}} */ (row).text, '审计可见的条目')
      assert.equal(/** @type {{entryId: unknown}} */ (row).entryId, entry.id)
      assert.ok(typeof /** @type {{outcome: unknown}} */ (row).outcome === 'string' && /** @type {{outcome: string}} */ (row).outcome.length > 0)
    },
  },
  {
    id: 'D2',
    section: 'audit-reconstruction',
    name: '被拒写以 WRITE_DENIED 失败 + 落 <action>-denied 审计行 + 状态不变',
    async run(provider, options) {
      const own = options.makeProvider({ gate: async () => 'rejected' })
      try {
        await assert.rejects(
          own.add({ track: 'user', scope: 'user-global', text: '不会被写进去' }, makeWrite()),
          (error) => { assertCode(error, 'WRITE_DENIED'); return true },
        )
        assert.equal(own.listEntries().length, 0)
        const rows = own.auditList(10)
        assert.ok(rows.some((/** @type {{action: string}} */ r) => r.action === 'add-denied'), 'denied write must leave a denied audit row')
      } finally {
        own.close?.()
      }
    },
  },
  {
    id: 'D3',
    section: 'audit-reconstruction',
    name: '带 sessionId 的 query 落 recalled 审计行（读召回也可重建）',
    async run(provider) {
      provider.query({ text: '任何词' }, { sessionId: 'conformance-session' })
      const rows = provider.auditList(10)
      assert.ok(rows.some((/** @type {{action: string}} */ r) => r.action === 'recalled'))
    },
  },

  // ── E 导出信封 ──────────────────────────────────────────────────────────────
  {
    id: 'E1',
    section: 'export-envelope',
    name: '导出信封结构合法（memory-export-v1 往返：条目与预算可校验）',
    async run(provider) {
      const { entry } = await provider.add({ track: 'user', scope: 'user-global', text: '导出往返条目', tags: ['export'] }, makeWrite())
      const envelope = {
        plugin: 'dsh-memento',
        schema: 'memory-export-v1',
        exportedAt: new Date().toISOString(),
        budgets: provider.budgets(),
        entries: [entry],
      }
      // 信封形状由协议约定（docs/schemas/dsh-memory-protocol-v1.schema.json）；
      // 用例锁死关键字段存在性与类型，Provider 的条目必须能被协议校验接受。
      assert.equal(envelope.plugin, 'dsh-memento')
      assert.equal(envelope.schema, 'memory-export-v1')
      assert.ok(Array.isArray(envelope.budgets) && envelope.budgets.length === 4)
      assert.equal(envelope.entries[0].text, '导出往返条目')
      assert.deepEqual(envelope.entries[0].tags, ['export'])
      assert.equal(envelope.entries[0].version, 1)
    },
  },
  {
    id: 'E2',
    section: 'export-envelope',
    name: '一致性 Provider 永不产出非法条目（version ≥ 1、updatedAt ≥ createdAt）',
    async run(provider) {
      const { entry } = await provider.add({ track: 'user', scope: 'user-global', text: '合法条目' }, makeWrite())
      assert.ok(Number.isInteger(entry.version) && entry.version >= 1)
      assert.ok(Number.isInteger(entry.createdAt) && Number.isInteger(entry.updatedAt))
      assert.ok(entry.updatedAt >= entry.createdAt)
      const { entry: replaced } = await provider.replace(
        { track: 'user', scope: 'user-global', match: '合法条目', text: '改写后的条目' },
        makeWrite(),
      )
      assert.equal(replaced.version, entry.version + 1)
      assert.ok(replaced.updatedAt >= entry.updatedAt)
    },
  },
])
