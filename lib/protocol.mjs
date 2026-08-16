// lib/protocol.mjs — dsh-memory-protocol v1（零 DSH 依赖）。
//
// 协议与实现分离：本文件是协议的规范实现面，只依赖 node: 内置与同目录零依赖模块
// （constants/errors/budget/workspace），不 import 任何 DSH 包。index.mjs 的
// MemoryService 继承 MemoryProtocolCore，只注入两件 DSH 专属物：审批传输
// （gate 回调）与会话事件派发（emit 回调）。一致性套件（test/protocol-conformance/）
// 用同一 core + 自动放行 gate 作为黄金参考——任何声称兼容的 Provider 跑同一套用例。
//
// 协议语义的权威文档是 docs/protocol-v1.md 与 docs/schemas/dsh-memory-protocol-v1.schema.json；
// 本文件的校验函数实现同一组约束（仓库零运行时依赖，不引 JSON Schema 引擎）。

import { TRACKS, SCOPES, DEFAULT_SOURCE, SESSION_EVENTS, MAX_CONSOLIDATE_MATCHES } from './constants.mjs'
import { InvalidInputError, BudgetExceededError, EntryNotFoundError, AmbiguousMatchError, WriteDeniedError, NoAgentError } from './errors.mjs'
import { checkBudget, budgetReport, budgetLimits } from './budget.mjs'
import { normalizeWritePolicy } from './gate.mjs'
import { workspaceKeyOf, agentKeyOf } from './workspace.mjs'

/** 协议标识（文档、导出信封与一致性报告里的稳定名字）。 */
export const PROTOCOL_ID = 'dsh-memory-protocol'

/** 协议版本（与 docs/schemas/dsh-memory-protocol-v1.schema.json 同步）。 */
export const PROTOCOL_VERSION = 1

/** 协议 URI：`<PROTOCOL_ID>/v<PROTOCOL_VERSION>`。 */
export const PROTOCOL_URI = `${PROTOCOL_ID}/v${PROTOCOL_VERSION}`

/** 每条目的标签数上限（协议常量，非部署 tunable）。 */
export const MAX_TAGS_PER_ENTRY = 16

/** 单个标签字符数上限（JS 字符，协议常量）。 */
export const MAX_TAG_LENGTH = 32

/** 条目 id 形状：UUID v4（Provider 生成，跨会话稳定）。 */
export const ENTRY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * 标签规范化与校验（协议 v1 条目规范的一部分）：
 * - 必须是字符串数组；逐项 trim 后非空；
 * - 去重（保持首次出现顺序）；禁止控制字符；
 * - 单条 ≤ MAX_TAG_LENGTH 字符，条数 ≤ MAX_TAGS_PER_ENTRY。
 * 违反任何一条响亮失败（INVALID_INPUT），绝不静默丢弃。
 * @param {unknown} tags - 输入标签（undefined/null = 无标签）。
 * @returns {string[]} 规范化标签数组。
 */
export function normalizeTags(tags) {
  if (tags === undefined || tags === null) return []
  if (!Array.isArray(tags)) {
    throw new InvalidInputError('entry tags must be an array of strings')
  }
  const seen = new Set()
  const result = []
  for (const raw of tags) {
    if (typeof raw !== 'string') {
      throw new InvalidInputError('entry tags must be an array of strings')
    }
    const tag = raw.trim()
    if (tag.length === 0) {
      throw new InvalidInputError('entry tags must be non-empty strings')
    }
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(tag)) {
      throw new InvalidInputError(`entry tag ${JSON.stringify(tag)} contains control characters`)
    }
    if (tag.length > MAX_TAG_LENGTH) {
      throw new InvalidInputError(`entry tag ${JSON.stringify(tag.slice(0, 20))}… exceeds ${MAX_TAG_LENGTH} chars`)
    }
    if (!seen.has(tag)) {
      seen.add(tag)
      result.push(tag)
    }
  }
  if (result.length > MAX_TAGS_PER_ENTRY) {
    throw new InvalidInputError(`entry has ${result.length} tags; at most ${MAX_TAGS_PER_ENTRY} are allowed`)
  }
  return result
}

/**
 * 落盘条目的结构校验（一致性套件与导入共用；协议条目规范的机器实现面）。
 * @param {unknown} entry - 待校验条目。
 * @returns {{id: string, track: string, scope: string, workspaceKey: string, agentKey: string, text: string, source: string, tags: string[], version: number, createdAt: number, updatedAt: number, lastRecalled: number | null, recallCount: number, sessionId: string | null}} 校验通过的条目（字段已核对）。
 */
export function validateMemoryEntry(entry) {
  if (entry === null || typeof entry !== 'object') {
    throw new InvalidInputError('memory entry must be an object')
  }
  const record = /** @type {{[key: string]: unknown}} */ (entry)
  if (typeof record.id !== 'string' || !ENTRY_ID_PATTERN.test(record.id)) {
    throw new InvalidInputError(`memory entry id must be a UUID v4 string (got ${JSON.stringify(record.id)})`)
  }
  if (!/** @type {readonly string[]} */ (TRACKS).includes(/** @type {string} */ (record.track)) || !/** @type {readonly string[]} */ (SCOPES).includes(/** @type {string} */ (record.scope))) {
    throw new InvalidInputError(`invalid memory scope: track=${JSON.stringify(record.track)} scope=${JSON.stringify(record.scope)}`)
  }
  if (typeof record.workspaceKey !== 'string' || typeof record.agentKey !== 'string') {
    throw new InvalidInputError('memory entry workspaceKey/agentKey must be strings')
  }
  if (typeof record.text !== 'string' || record.text.length === 0) {
    throw new InvalidInputError('memory entry text must be a non-empty string')
  }
  if (typeof record.source !== 'string' || record.source.length === 0) {
    throw new InvalidInputError('memory entry source must be a non-empty string')
  }
  if (!Number.isInteger(record.version) || /** @type {number} */ (record.version) < 1) {
    throw new InvalidInputError(`memory entry version must be an integer >= 1 (got ${JSON.stringify(record.version)})`)
  }
  if (!Number.isInteger(record.createdAt) || !Number.isInteger(record.updatedAt) || /** @type {number} */ (record.updatedAt) < /** @type {number} */ (record.createdAt)) {
    throw new InvalidInputError('memory entry timestamps must be integers with updatedAt >= createdAt')
  }
  if (record.lastRecalled !== null && !Number.isInteger(record.lastRecalled)) {
    throw new InvalidInputError('memory entry lastRecalled must be null or an integer timestamp')
  }
  if (!Number.isInteger(record.recallCount) || /** @type {number} */ (record.recallCount) < 0) {
    throw new InvalidInputError('memory entry recallCount must be a non-negative integer')
  }
  if (record.sessionId !== null && typeof record.sessionId !== 'string') {
    throw new InvalidInputError('memory entry sessionId must be null or a string')
  }
  const tags = normalizeTags(record.tags)
  return {
    id: /** @type {string} */ (record.id),
    track: /** @type {string} */ (record.track),
    scope: /** @type {string} */ (record.scope),
    workspaceKey: /** @type {string} */ (record.workspaceKey),
    agentKey: /** @type {string} */ (record.agentKey),
    text: /** @type {string} */ (record.text),
    source: /** @type {string} */ (record.source),
    tags,
    version: /** @type {number} */ (record.version),
    createdAt: /** @type {number} */ (record.createdAt),
    updatedAt: /** @type {number} */ (record.updatedAt),
    lastRecalled: /** @type {number | null} */ (record.lastRecalled),
    recallCount: /** @type {number} */ (record.recallCount),
    sessionId: /** @type {string | null} */ (record.sessionId),
  }
}

/**
 * 导出信封校验（dsh-memento 的 memory-export-v1 文档；备份/迁移/一致性用例共用）。
 * @param {unknown} payload - JSON 文档。
 * @returns {{plugin: string, schema: string, exportedAt: string, budgets: Array<{track: string, scope: string, used: number, limit: number}>, entries: ReturnType<typeof validateMemoryEntry>[]}} 校验通过的信封。
 */
export function validateExportEnvelope(payload) {
  if (payload === null || typeof payload !== 'object') {
    throw new InvalidInputError('export document must be an object')
  }
  const record = /** @type {{[key: string]: unknown}} */ (payload)
  if (record.plugin !== 'dsh-memento' || record.schema !== 'memory-export-v1') {
    throw new InvalidInputError('export document must declare plugin "dsh-memento" and schema "memory-export-v1"')
  }
  if (typeof record.exportedAt !== 'string' || Number.isNaN(Date.parse(record.exportedAt))) {
    throw new InvalidInputError('export document exportedAt must be an ISO timestamp string')
  }
  if (!Array.isArray(record.budgets)) {
    throw new InvalidInputError('export document budgets must be an array')
  }
  const budgets = record.budgets.map((row) => {
    if (row === null || typeof row !== 'object') throw new InvalidInputError('export budget row must be an object')
    const r = /** @type {{[key: string]: unknown}} */ (row)
    if (!/** @type {readonly string[]} */ (TRACKS).includes(/** @type {string} */ (r.track)) || !/** @type {readonly string[]} */ (SCOPES).includes(/** @type {string} */ (r.scope))) {
      throw new InvalidInputError(`export budget row has invalid track/scope: ${JSON.stringify(r.track)}/${JSON.stringify(r.scope)}`)
    }
    if (!Number.isInteger(r.used) || !Number.isInteger(r.limit) || /** @type {number} */ (r.used) < 0 || /** @type {number} */ (r.limit) < 0) {
      throw new InvalidInputError('export budget row used/limit must be non-negative integers')
    }
    return { track: /** @type {string} */ (r.track), scope: /** @type {string} */ (r.scope), used: /** @type {number} */ (r.used), limit: /** @type {number} */ (r.limit) }
  })
  if (!Array.isArray(record.entries)) {
    throw new InvalidInputError('export document entries must be an array')
  }
  const entries = record.entries.map((entry) => validateMemoryEntry(entry))
  return { plugin: 'dsh-memento', schema: 'memory-export-v1', exportedAt: /** @type {string} */ (record.exportedAt), budgets, entries }
}

/**
 * 审计行结构校验（协议审计事件规范：任何写入可由审计账本 + 审批审计对重建）。
 * @param {unknown} row - 审计行。
 * @returns {{seq: number, ts: number, action: string, track: string | null, scope: string | null, entryId: string | null, text: string | null, outcome: string | null, source: string | null, sessionId: string | null}} 校验通过的审计行。
 */
export function validateAuditRow(row) {
  if (row === null || typeof row !== 'object') {
    throw new InvalidInputError('audit row must be an object')
  }
  const r = /** @type {{[key: string]: unknown}} */ (row)
  if (!Number.isInteger(r.seq) || !Number.isInteger(r.ts)) {
    throw new InvalidInputError('audit row seq/ts must be integers')
  }
  if (typeof r.action !== 'string' || r.action.length === 0) {
    throw new InvalidInputError('audit row action must be a non-empty string')
  }
  for (const field of ['track', 'scope', 'entryId', 'text', 'outcome', 'source', 'sessionId']) {
    if (r[field] !== null && typeof r[field] !== 'string') {
      throw new InvalidInputError(`audit row ${field} must be null or a string`)
    }
  }
  return {
    seq: /** @type {number} */ (r.seq),
    ts: /** @type {number} */ (r.ts),
    action: /** @type {string} */ (r.action),
    track: /** @type {string | null} */ (r.track),
    scope: /** @type {string | null} */ (r.scope),
    entryId: /** @type {string | null} */ (r.entryId),
    text: /** @type {string | null} */ (r.text),
    outcome: /** @type {string | null} */ (r.outcome),
    source: /** @type {string | null} */ (r.source),
    sessionId: /** @type {string | null} */ (r.sessionId),
  }
}

/** 每轨每层硬字符预算形状（协议预算模型）。 */
/**
 * @typedef {object} ProtocolBudgets
 * @property {{userGlobal: number, workspace: number}} user
 * @property {{userGlobal: number, workspace: number}} agent
 */

/** 协议核心依赖的 Provider 面（lib/store.mjs 实现；一致性套件的第三方 Provider 同形状）。 */
/**
 * @typedef {object} ProtocolStore
 * @property {(filter?: {track?: string, scope?: string, text?: string, limit?: number, agentKey?: string}) => import('../types.js').MemoryQueryResult} queryEntries
 * @property {() => import('../types.js').MemoryEntry[]} listEntries
 * @property {(track: string, scope: string, match: string, opts?: {agentKey?: string, workspaceKey?: string}) => import('../types.js').MemoryEntry[]} matchCandidates
 * @property {(track: string, scope: string) => number} usage
 * @property {(input: object) => import('../types.js').MemoryEntry} insertEntry
 * @property {(inputs: object[]) => import('../types.js').MemoryEntry[]} seedEntries
 * @property {(input: object) => {previous: import('../types.js').MemoryEntry, entry: import('../types.js').MemoryEntry}} replaceEntry
 * @property {(input: object) => import('../types.js').MemoryEntry} removeEntry
 * @property {(input: object) => {removed: import('../types.js').MemoryEntry[], entry: import('../types.js').MemoryEntry}} consolidateEntries
 * @property {(row: object) => object} auditAppend
 * @property {(limit?: number) => object[]} auditList
 * @property {(input: object) => object | null} proposalUpsert
 * @property {(status?: string, limit?: number) => object[]} proposalList
 * @property {(id: string, status: string) => object} proposalDecide
 * @property {() => void} close
 */

/**
 * 协议写语义核心（dsh-memory-protocol v1 的参考实现，零 DSH 依赖）。
 *
 * 依赖注入的两个回调是它与具体 harness 的全部接触面：
 * - `gate(payload, write)`：写审批传输，返回 ApprovalOutcome；唯一放行值是
 *   `allowed-once`，其余（rejected/cancelled/unavailable）一律失败封闭并落
 *   `<action>-denied` 审计行。index.mjs 注入 ctx.approval 传输。
 * - `emit(session, type, data)`：会话事件派发回调（可选）；index.mjs 注入
 *   memory/* 词汇的已知类型自适应门。
 *
 * 写路径不变量（协议语义，一致性套件锁定）：
 * 预算预检 → gate → 预算复审 → 事务落盘 → 审计；任何一步失败无部分写入；
 * 替换/删除/整合以唯一大小写不敏感子串定位，零/多命中结构化报错。
 */
export class MemoryProtocolCore {
  /**
   * @param {object} deps - 依赖。
   * @param {ProtocolStore} deps.store - Provider（lib/store.mjs 面）。
   * @param {ProtocolBudgets} deps.budgets - 每轨每层硬字符预算。
   * @param {string} deps.writePolicy - ask/auto/off（非法值响亮失败）。
   * @param {number} [deps.defaultQueryLimit] - query 缺省返回上限（默认 20）。
   * @param {string} [deps.sourceLabel] - 条目默认来源标注（默认 dsh-memento）。
   * @param {(payload: object, write: object) => Promise<string>} deps.gate - 审批传输。
   * @param {(session: object | null | undefined, type: string, data: object) => void} [deps.emit] - 会话事件派发。
   */
  constructor(deps) {
    this.store = deps.store
    this.budgetsConfig = deps.budgets
    this.limits = budgetLimits(deps.budgets)
    this.writePolicy = normalizeWritePolicy(deps.writePolicy)
    this.defaultQueryLimit = deps.defaultQueryLimit ?? 20
    this.sourceLabel = deps.sourceLabel ?? DEFAULT_SOURCE
    this.gate = deps.gate
    this.emit = deps.emit ?? (() => {})
  }

  /** @returns {Array<{track: string, scope: string, used: number, limit: number}>} 预算报表。 */
  budgets() {
    return budgetReport(this.store.listEntries(), this.budgetsConfig)
  }

  /**
   * 查询条目（读路径无审批；带 sessionId 时记 recalled 审计）。
   * @param {{track?: string, scope?: string, text?: string, limit?: number}} [filter] - {track, scope, text, limit}。
   * @param {{sessionId?: string, session?: import('../types.js').MemorySessionLike | null, agentKey?: string}} [opts] - {sessionId, session, agentKey}。
   * @returns {import('../types.js').MemoryQueryResult}。
   */
  query(filter = {}, opts = {}) {
    const { entries, total, truncated } = this.store.queryEntries({
      ...(filter.track === undefined ? {} : { track: filter.track }),
      ...(filter.scope === undefined ? {} : { scope: filter.scope }),
      ...(typeof filter.text === 'string' && filter.text.length > 0 ? { text: filter.text } : {}),
      limit: Number.isInteger(filter.limit) && filter.limit > 0 ? filter.limit : this.defaultQueryLimit,
      ...(typeof opts.agentKey === 'string' ? { agentKey: opts.agentKey } : {}),
    })
    if (opts.sessionId !== undefined) {
      this.store.auditAppend({
        action: 'recalled',
        ...(filter.track === undefined ? {} : { track: filter.track }),
        ...(filter.scope === undefined ? {} : { scope: filter.scope }),
        text: typeof filter.text === 'string' ? filter.text : null,
        outcome: 'ok',
        source: this.sourceLabel,
        sessionId: opts.sessionId,
      })
    }
    if (opts.session !== undefined && opts.session !== null) {
      this.emit(opts.session, SESSION_EVENTS.recalled, {
        query: typeof filter.text === 'string' ? filter.text : '',
        matches: total,
        sessionId: opts.sessionId ?? opts.session.id ?? '',
      })
    }
    return { entries, total, truncated }
  }

  /**
   * 新增条目（写：审批门 + 预算门）。
   * @param {{track: string, scope: string, text: string, source?: string, workspaceKey?: string, agentKey?: string, tags?: string[]}} input - 写入输入。
   * @param {import('../types.js').MemoryWriteContext} write - {agent, callId?, signal?, gate?}；agent 缺失即失败封闭。
   * @returns {Promise<{entry: import('../types.js').MemoryEntry, usage: {track: string, scope: string, used: number, limit: number}}>}。
   */
  async add(input, write) {
    const { track, scope, text, tags } = this.#validateEntry(input, write)
    this.#assertBudget(track, scope, this.store.usage(track, scope), text.length)
    const via = await this.#ask({ action: 'add', track, scope, text, source: input.source ?? this.sourceLabel }, write)
    this.#throwIfAborted(write)
    // 审批等待期间用量可能变化：以此刻用量为权威复审。
    const now = this.store.usage(track, scope)
    this.#assertBudget(track, scope, now, text.length)
    const entry = this.store.insertEntry({
      track, scope, text, tags,
      workspaceKey: input.workspaceKey ?? this.#workspaceKeyOf(write),
      agentKey: input.agentKey ?? this.#agentKeyOf(write),
      source: input.source ?? this.sourceLabel,
      sessionId: write.agent.session?.id ?? null,
    })
    this.#auditWrite('add', track, scope, entry, write, via)
    this.#appendWriteEvent(write, SESSION_EVENTS.added, { entry, source: entry.source })
    return { entry, usage: this.#usage(track, scope) }
  }

  /**
   * 按唯一子串替换条目（写：审批门 + 预算门；零/多命中报错，绝不截断）。
   * @param {{track: string, scope: string, match: string, text: string, source?: string, agentKey?: string, workspaceKey?: string, tags?: string[]}} input - 替换方案。
   * @param {import('../types.js').MemoryWriteContext} write - {agent, callId?, signal?, gate?}。
   * @returns {Promise<{previous: import('../types.js').MemoryEntry, entry: import('../types.js').MemoryEntry, usage: {track: string, scope: string, used: number, limit: number}}>}。
   */
  async replace(input, write) {
    const { track, scope, text, tags } = this.#validateEntry(input, write)
    this.#assertMatch(input)
    // 审批前先定位：零/多命中在打扰用户之前就响亮失败。
    const initial = this.#resolveMatch(input, track, scope, write)
    this.#assertBudget(track, scope, this.store.usage(track, scope), text.length - initial.text.length)
    // 审批载荷携带将被改写的旧条目全文（approve-what-you-see：人批准的不是抽象动作，是具体变更）。
    const via = await this.#ask({
      action: 'replace', track, scope,
      text: `from:\n${initial.text}\n\nto:\n${text}`,
      source: input.source ?? this.sourceLabel,
    }, write)
    this.#throwIfAborted(write)
    // 审批等待期间目标条目可能已被并发写改动：以此刻重新定位的 previous 为权威重算净变化，
    // 再用此刻用量复审。复审与 replaceEntry 之间无 await，判断与实际写入之间不存在窗口。
    const current = this.#resolveMatch(input, track, scope, write)
    const net = text.length - current.text.length
    this.#assertBudget(track, scope, this.store.usage(track, scope), net)
    // 事务内重新定位+更新：零/多命中仍会响亮报错（不静默）。
    const replaced = this.store.replaceEntry({
      track, scope, match: input.match, text,
      ...(tags.length > 0 ? { tags } : {}),
      sessionId: write.agent.session?.id ?? null,
    })
    this.#auditWrite('replace', track, scope, replaced.entry, write, via)
    this.#appendWriteEvent(write, SESSION_EVENTS.updated, {
      previous: replaced.previous,
      entry: replaced.entry,
      source: replaced.entry.source,
    })
    return { previous: replaced.previous, entry: replaced.entry, usage: this.#usage(track, scope) }
  }

  /**
   * 按唯一子串删除条目（写：审批门；零/多命中报错）。
   * @param {{track: string, scope: string, match: string, agentKey?: string, workspaceKey?: string}} input - 定位。
   * @param {import('../types.js').MemoryWriteContext} write - {agent, callId?, signal?, gate?}。
   * @returns {Promise<{entry: import('../types.js').MemoryEntry, usage: {track: string, scope: string, used: number, limit: number}}>}。
   */
  async remove(input, write) {
    this.#assertAgent(write)
    this.#assertScope(input.track, input.scope)
    this.#assertMatch(input)
    // 审批前先定位：零/多命中在打扰用户之前就响亮失败。
    const target = this.#resolveMatch(input, input.track, input.scope, write)
    // 审批载荷携带将被删除的条目全文（approve-what-you-see），而非裸子串。
    const via = await this.#ask({ action: 'remove', track: input.track, scope: input.scope, text: target.text, source: target.source }, write)
    this.#throwIfAborted(write)
    const removed = this.store.removeEntry({ track: input.track, scope: input.scope, match: input.match })
    this.#auditWrite('remove', input.track, input.scope, removed, write, via)
    this.#appendWriteEvent(write, SESSION_EVENTS.removed, { entry: removed, source: removed.source })
    return { entry: removed, usage: this.#usage(input.track, input.scope) }
  }

  /**
   * 批量种子（一次 ask 审批整个批次；dsh-claude-move 等插件喂数据用）。
   * 任一条超预算 → 整批拒绝（先全量预检再落盘，无部分写入）。
   * @param {Array<{track: string, scope: string, text: string, source?: string, workspaceKey?: string, agentKey?: string, tags?: string[]}>} inputs - 条目数组。
   * @param {import('../types.js').MemoryWriteContext} write - {agent, callId?, signal?, gate?}。
   * @returns {Promise<{added: number, entries: import('../types.js').MemoryEntry[]}>}。
   */
  async seed(inputs, write) {
    this.#assertAgent(write)
    if (!Array.isArray(inputs) || inputs.length === 0) {
      throw new InvalidInputError('seed requires a non-empty entry list')
    }
    const normalized = inputs.map((input) => {
      const { track, scope, text, tags } = this.#validateEntry(input, write)
      return {
        track, scope, text, tags,
        source: input.source ?? this.sourceLabel,
        workspaceKey: input.workspaceKey ?? this.#workspaceKeyOf(write),
        agentKey: input.agentKey ?? this.#agentKeyOf(write),
      }
    })
    const summary = normalized.map((entry) => `${entry.track}/${entry.scope}: ${entry.text}`).join('\n')
    const via = await this.#ask({
      action: 'seed', track: 'batch', scope: 'batch', text: summary, count: normalized.length,
    }, write)
    this.#throwIfAborted(write)
    // 全量预检（任意一条超限整批拒绝）；通过后同步插入，无 await 间隔。
    for (const [track, scope] of uniqueScopes(normalized)) {
      const used = this.store.usage(track, scope)
      const addition = normalized
        .filter((entry) => entry.track === track && entry.scope === scope)
        .reduce((sum, entry) => sum + entry.text.length, 0)
      this.#assertBudget(track, scope, used, addition)
    }
    const sessionId = write.agent.session?.id ?? null
    const entries = this.store.seedEntries(normalized.map((entry) => ({ ...entry, sessionId })))
    this.store.auditAppend({
      action: 'seed',
      track: null, scope: null, entryId: null,
      text: summary, outcome: this.#outcomeLabel(via),
      source: this.sourceLabel, sessionId,
    })
    for (const entry of entries) {
      this.#auditWrite('add', entry.track, entry.scope, entry, write, via)
      this.#appendWriteEvent(write, SESSION_EVENTS.added, { entry, source: entry.source })
    }
    return { added: entries.length, entries }
  }

  /**
   * 整合多个条目为一条新条目（写：审批门 + 预算门；一次审批 + Provider 单事务原子执行）。
   * 零/多命中、超预算、审批拒绝、目标在审批期间消失都响亮失败；任一步失败无部分写入。
   * @param {{track: string, scope: string, matches: string[], text: string, source?: string, workspaceKey?: string, agentKey?: string, tags?: string[]}} input - 整合方案。
   * @param {import('../types.js').MemoryWriteContext} write - {agent, callId?, signal?, gate?}。
   * @returns {Promise<{removed: import('../types.js').MemoryEntry[], entry: import('../types.js').MemoryEntry, usage: {track: string, scope: string, used: number, limit: number}}>}。
   */
  async consolidate(input, write) {
    const { track, scope, text, tags } = this.#validateEntry(input, write)
    this.#assertConsolidateMatches(input)
    // 审批前先定位全部目标：零/多命中在打扰用户之前就响亮失败。
    const initial = input.matches.map((match) => this.#resolveMatch({ match }, track, scope, write))
    const removalBefore = initial.reduce((sum, entry) => sum + entry.text.length, 0)
    this.#assertBudget(track, scope, this.store.usage(track, scope), text.length - removalBefore)
    // 审批载荷携带每个目标的定位条目原文（单条超长只截前 300 字，避免 20×满预算条目撑爆载荷）。
    const plan = [
      ...initial.map((entry, index) => {
        const body = entry.text.length > 300 ? `${entry.text.slice(0, 300)}…` : entry.text
        return `remove: ${input.matches[index]}\n${body}`
      }),
      `new text: ${text}`,
    ].join('\n')
    const via = await this.#ask({ action: 'consolidate', track, scope, text: plan, source: input.source ?? this.sourceLabel }, write)
    this.#throwIfAborted(write)
    // 审批等待期间目标可能被并发写改动：重新定位并以此刻为权威重算净变化。
    const current = input.matches.map((match) => this.#resolveMatch({ match }, track, scope, write))
    const removalNow = current.reduce((sum, entry) => sum + entry.text.length, 0)
    this.#assertBudget(track, scope, this.store.usage(track, scope), text.length - removalNow)
    const { removed, entry } = this.store.consolidateEntries({
      track, scope, matches: input.matches, text,
      source: input.source ?? this.sourceLabel,
      workspaceKey: input.workspaceKey ?? this.#workspaceKeyOf(write),
      agentKey: input.agentKey ?? this.#agentKeyOf(write),
      ...(tags.length > 0 ? { tags } : {}),
      sessionId: write.agent.session?.id ?? null,
    })
    const sessionId = write.agent.session?.id ?? null
    for (const old of removed) {
      this.store.auditAppend({
        action: 'consolidate-remove', track, scope, entryId: old.id, text: old.text,
        outcome: this.#outcomeLabel(via), source: old.source, sessionId,
      })
      this.#appendWriteEvent(write, SESSION_EVENTS.removed, { entry: old, source: old.source })
    }
    this.store.auditAppend({
      action: 'consolidate-add', track, scope, entryId: entry.id, text: entry.text,
      outcome: this.#outcomeLabel(via), source: entry.source, sessionId,
    })
    this.#appendWriteEvent(write, SESSION_EVENTS.added, { entry, source: entry.source })
    return { removed, entry, usage: this.#usage(track, scope) }
  }

  /**
   * 写路径审批门。默认走注入的 gate（index.mjs 注入 ctx.approval.request 传输）。
   * write.gate 为可选自定义传输（/memory 命令在 turn 外使用：同一裁决语义）。
   * 被拒（rejected/cancelled/unavailable/off）一律落 `<action>-denied` 审计行再抛——
   * turn 外 gate 路径没有审批审计对，这是拒绝的唯一证据链。
   * @param {{action: string, track: string, scope: string, text: string, count?: number, source?: string}} payload - {action, track, scope, text, count?}。
   * @param {import('../types.js').MemoryWriteContext} write - {agent, callId?, signal?, gate?}。
   * @returns {Promise<{outcome: string, source: 'approval'|'gate'}>} 实际裁决结果与传输来源（审计标签用）。
   */
  async #ask(payload, write) {
    try {
      const via = typeof write.gate === 'function'
        ? { outcome: await write.gate(payload, write), source: /** @type {'approval'|'gate'} */ ('gate') }
        : { outcome: await this.gate(payload, write), source: /** @type {'approval'|'gate'} */ ('approval') }
      this.#assertOutcome(via.outcome)
      return via
    } catch (error) {
      if (error instanceof WriteDeniedError) {
        const outcome = typeof error.details.outcome === 'string' ? error.details.outcome : 'denied'
        const viaLabel = typeof write.gate === 'function'
          ? `${outcome} (via write gate)`
          : `${outcome} (via approval, writePolicy ${this.writePolicy})`
        this.store.auditAppend({
          action: `${payload.action}-denied`,
          track: payload.track,
          scope: payload.scope,
          entryId: null,
          text: payload.text,
          outcome: viaLabel,
          source: payload.source ?? this.sourceLabel,
          sessionId: write.agent?.session?.id ?? null,
        })
      }
      throw error
    }
  }

  /** 审计 outcome 标签：审批传输标注策略，gate 传输标注 gate（真实裁决来源，不张冠李戴）。 */
  #outcomeLabel(/** @type {{outcome: string, source: 'approval'|'gate'}} */ via) {
    return via.source === 'gate'
      ? `${via.outcome} (via write gate)`
      : `${via.outcome} (via approval, writePolicy ${this.writePolicy})`
  }

  /** 写路径必须有 agent（审批路由与审计归属）：缺失即失败封闭。 */
  #assertAgent(/** @type {import('../types.js').MemoryWriteContext} */ write) {
    if (write === null || typeof write !== 'object' || write.agent === undefined || write.agent === null) {
      throw new NoAgentError()
    }
  }

  /** track/scope 词汇校验（响亮失败，绝不落到 SQL）。 */
  #assertScope(/** @type {string} */ track, /** @type {string} */ scope) {
    if (!/** @type {readonly string[]} */ (TRACKS).includes(track) || !/** @type {readonly string[]} */ (SCOPES).includes(scope)) {
      throw new InvalidInputError(`invalid memory scope: track=${JSON.stringify(track)} scope=${JSON.stringify(scope)} (track ∈ ${TRACKS.join('|')}, scope ∈ ${SCOPES.join('|')})`)
    }
  }

  /** match 参数校验（replace/remove 共用）。 */
  #assertMatch(/** @type {{match?: unknown}} */ input) {
    if (typeof input.match !== 'string' || input.match.length === 0) {
      throw new InvalidInputError('replace/remove match must be a non-empty string')
    }
  }

  /** consolidate matches 校验（1..MAX_CONSOLIDATE_MATCHES 个非空字符串）。 */
  #assertConsolidateMatches(/** @type {{matches?: unknown}} */ input) {
    if (!Array.isArray(input.matches) || input.matches.length === 0 || input.matches.length > MAX_CONSOLIDATE_MATCHES) {
      throw new InvalidInputError(`consolidate matches must be an array of 1..${MAX_CONSOLIDATE_MATCHES} non-empty strings`)
    }
    for (const match of input.matches) {
      if (typeof match !== 'string' || match.length === 0) {
        throw new InvalidInputError(`consolidate matches must be an array of 1..${MAX_CONSOLIDATE_MATCHES} non-empty strings`)
      }
    }
  }

  /** 条目公共校验：agent + scope + 非空文本 + 标签。 */
  #validateEntry(/** @type {{track: string, scope: string, text: string, tags?: string[]}} */ input, /** @type {import('../types.js').MemoryWriteContext} */ write) {
    this.#assertAgent(write)
    this.#assertScope(input.track, input.scope)
    if (typeof input.text !== 'string' || input.text.length === 0) {
      throw new InvalidInputError('entry text must be a non-empty string')
    }
    return { track: input.track, scope: input.scope, text: input.text, tags: normalizeTags(input.tags) }
  }

  /**
   * 审批前定位替换/删除目标（唯一子串语义，大小写不敏感，零/多命中结构化报错）。
   * 写定位 = 会话可见集：agentKey 共享 + 写方会话键（显式 input 覆盖）；scope='workspace'
   * 时按写方会话 cwd 键过滤——跨 agent/跨工作区条目对本会话不可见、也不可被误改。
   */
  #resolveMatch(/** @type {{match: string, agentKey?: string, workspaceKey?: string}} */ input, /** @type {string} */ track, /** @type {string} */ scope, /** @type {import('../types.js').MemoryWriteContext} */ write) {
    const agentKey = typeof input.agentKey === 'string' && input.agentKey.length > 0 ? input.agentKey : this.#agentKeyOf(write)
    const workspaceKey = typeof input.workspaceKey === 'string' && input.workspaceKey.length > 0 ? input.workspaceKey : this.#workspaceKeyOf(write)
    const hits = /** @type {import('../types.js').MemoryEntry[]} */ (this.store.matchCandidates(track, scope, input.match, {
      agentKey,
      workspaceKey: scope === 'workspace' ? workspaceKey : undefined,
    }))
      .filter((entry) => entry.text.toLowerCase().includes(input.match.toLowerCase()))
    if (hits.length === 0) throw new EntryNotFoundError({ track, scope, match: input.match })
    if (hits.length > 1) {
      throw new AmbiguousMatchError({
        track, scope, match: input.match,
        candidates: hits.length,
        sample: hits.map((entry) => entry.text.length > 200 ? `${entry.text.slice(0, 200)}…` : entry.text),
      })
    }
    return hits[0]
  }

  /** 预算门：超限抛 BudgetExceededError（结构化，含用量与上限），绝不截断。 */
  #assertBudget(/** @type {string} */ track, /** @type {string} */ scope, /** @type {number} */ used, /** @type {number} */ addition) {
    const checked = checkBudget(used, this.limits[/** @type {'user'|'agent'} */ (track)][/** @type {'user-global'|'workspace'} */ (scope)], addition)
    if (!checked.ok) {
      const d = /** @type {{used: number, limit: number, needed: number}} */ (checked)
      throw new BudgetExceededError({ track, scope, used: d.used, limit: d.limit, needed: d.needed })
    }
  }

  /** 审批结果门：唯一放行是 allowed-once。 */
  #assertOutcome(/** @type {string} */ outcome) {
    if (outcome !== 'allowed-once') throw new WriteDeniedError(outcome)
  }

  /** @param {{signal?: AbortSignal}} write - {signal?}。 */
  #throwIfAborted(write) {
    write.signal?.throwIfAborted()
  }

  /** 写成功的审计行（outcome 携带真实裁决来源：审批传输标注策略，gate 传输标注 gate）。 */
  #auditWrite(/** @type {string} */ action, /** @type {string} */ track, /** @type {string} */ scope, /** @type {import('../types.js').MemoryEntry} */ entry, /** @type {import('../types.js').MemoryWriteContext} */ write, /** @type {{outcome: string, source: 'approval'|'gate'}} */ via) {
    this.store.auditAppend({
      action,
      track,
      scope,
      entryId: entry.id,
      text: entry.text,
      outcome: this.#outcomeLabel(via),
      source: entry.source,
      sessionId: write.agent.session?.id ?? null,
    })
  }

  /** 写事件派发（emit 回调决定是否落会话日志——index.mjs 注入已知类型自适应门）。 */
  #appendWriteEvent(/** @type {import('../types.js').MemoryWriteContext} */ write, /** @type {string} */ type, /** @type {object} */ data) {
    const sessionId = write.agent.session?.id ?? ''
    this.emit(write.agent.session, type, { ...data, sessionId })
  }

  /** (track, scope) 用量与上限（工具结果回带，模型据此整合重试）。 */
  #usage(/** @type {string} */ track, /** @type {string} */ scope) {
    return { track, scope, used: this.store.usage(track, scope), limit: this.limits[/** @type {'user'|'agent'} */ (track)][/** @type {'user-global'|'workspace'} */ (scope)] }
  }

  /** @param {{agent?: {session?: import('../types.js').MemorySessionLike | null} | null}} write - {agent}。 */
  #workspaceKeyOf(write) {
    return workspaceKeyOf(/** @type {string | undefined} */ (write.agent?.session?.header?.cwd))
  }

  /** @param {{agent?: {session?: import('../types.js').MemorySessionLike | null} | null}} write - {agent}。 */
  #agentKeyOf(write) {
    return agentKeyOf(/** @type {string | undefined} */ (write.agent?.session?.header?.agentPreset))
  }
}

/** 去重的 (track, scope) 组合（seed 预检用）。 */
function uniqueScopes(/** @type {Array<{track: string, scope: string}>} */ entries) {
  const seen = new Set()
  const result = []
  for (const entry of entries) {
    const key = `${entry.track}/${entry.scope}`
    if (!seen.has(key)) {
      seen.add(key)
      result.push([entry.track, entry.scope])
    }
  }
  return result
}
