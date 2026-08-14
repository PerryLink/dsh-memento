// index.mjs — dsh-memento 插件入口（唯一 host 面文件）。
//
// 三角色 seam：
// - Service Definition：ctx.memory（add/replace/remove/query/seed + budgets），
//   写方法内部强制走审批门（waterfall 审批接缝），模型无论经哪个工具/插件
//   间接调用服务都无法绕过（S3）。
// - Provider：lib/store.mjs 本地 SQLite（node:sqlite，零依赖，WAL）。
// - Consumer：memory 工具 + 冻结快照注入（systemPrompt 段，同步提供者）。
//
// 只消费公开服务：tools / systemPrompt / approval（inject 声明）。
// DSH 依赖只出现在本文件；lib/ 零 DSH 依赖。

import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import {
  TRACKS,
  SCOPES,
  TOOL_NAME,
  DEFAULT_SOURCE,
  SESSION_EVENTS,
} from './lib/constants.mjs'
import {
  MemoryError,
  InvalidInputError,
  BudgetExceededError,
  EntryNotFoundError,
  AmbiguousMatchError,
  WriteDeniedError,
  NoAgentError,
} from './lib/errors.mjs'
import { checkBudget, budgetReport, budgetLimits, validateBudgets } from './lib/budget.mjs'
import { buildWriteReason, isMemoryWriteRequest, applyWritePolicy, normalizeWritePolicy } from './lib/gate.mjs'
import { renderSnapshot, visibleEntries } from './lib/snapshot.mjs'
import { openMemoryStore, resolveDbPath } from './lib/store.mjs'
import { workspaceKeyOf } from './lib/workspace.mjs'
import { extractEventText } from './lib/extract.mjs'

/**
 * @typedef {import('./types.js').MemoryEntry} MemoryEntry
 * @typedef {import('./types.js').MemoryQueryResult} MemoryQueryResult
 * @typedef {import('./types.js').MemoryWriteContext} MemoryWriteContext
 * @typedef {import('./types.js').MemorySessionLike} MemorySessionLike
 * @typedef {{user: {userGlobal: number, workspace: number}, agent: {userGlobal: number, workspace: number}}} BudgetsConfig
 * @typedef {object} StoreHandle - ctx.memory 依赖的 Provider 面。
 * @property {(filter?: {track?: string, scope?: string, text?: string, limit?: number}) => MemoryQueryResult} queryEntries
 * @property {() => MemoryEntry[]} listEntries
 * @property {(track: string, scope: string) => number} usage
 * @property {(input: object) => MemoryEntry} insertEntry
 * @property {(input: object) => {previous: MemoryEntry, entry: MemoryEntry}} replaceEntry
 * @property {(input: object) => MemoryEntry} removeEntry
 * @property {(row: object) => object} auditAppend
 * @property {(limit?: number) => object[]} auditList
 * @property {() => void} close
 * @typedef {{request: (req: object) => Promise<string>, overrideOf?: (session: unknown) => string | undefined, config?: {policy?: string}}} ApprovalLike
 * @typedef {object} ServiceDeps
 * @property {StoreHandle} store
 * @property {BudgetsConfig} budgets
 * @property {string} writePolicy
 * @property {number} maxEntriesPerQuery
 * @property {ApprovalLike} approval
 * @property {string} [sourceLabel]
 * @typedef {object} PluginConfig - apply 的宽松配置形状（cordis loader 已套 schema 默认值）。
 * @property {boolean} [enabled]
 * @property {string} [dbPath]
 * @property {{user?: {userGlobal?: number, workspace?: number}, agent?: {userGlobal?: number, workspace?: number}}} [budgets]
 * @property {string} [writePolicy]
 * @property {number} [snapshotOrder]
 * @property {number} [maxEntriesPerQuery]
 * @typedef {{action: string, track: string, scope: string, text: string, count?: number}} WritePayload
 * @typedef {{agent?: {session?: MemorySessionLike | null} | null, callId?: unknown, signal?: AbortSignal}} AskWrite
 * @typedef {{track: string, scope: string, text: string}} PublicEntry
 * @typedef {object} MemoryToolValue - memory 工具规范结果形状。
 * @property {boolean} ok
 * @property {string} action
 * @property {{message: string}} [error]
 * @property {PublicEntry[]} [entries]
 * @property {boolean} [truncated]
 * @property {number} [total]
 * @property {PublicEntry} [entry]
 * @property {{used: number, limit: number}} [usage]
 * @typedef {object} RecallToolValue - memory_recall 工具规范结果形状。
 * @property {{total: number, entries: PublicEntry[], truncated: boolean}} memory
 * @property {{available: boolean, error?: string, sessions: Array<{sessionId: string, matches: number, snippets: string[]}>}} history
 * @typedef {object} PanelResponse - node:http 响应最小面。
 * @property {(status: number, headers?: object) => unknown} writeHead
 * @property {(body: string) => unknown} end
 */

export const name = 'memento'

export const inject = ['tools', 'systemPrompt', 'approval']

/** 默认预算：user 轨 2000 字符/层，agent 轨 4000 字符/层（中文场景按需调大，见 README）。 */
export const DEFAULT_BUDGETS = Object.freeze({
  user: Object.freeze({ userGlobal: 2000, workspace: 2000 }),
  agent: Object.freeze({ userGlobal: 4000, workspace: 4000 }),
})

/** 快照段注入顺序：harness identity(-100) 之后、persona(0) 之前（负数=靠前）。 */
export const DEFAULT_SNAPSHOT_ORDER = -50

/**
 * 插件配置（Schemastery，全部可 cordis.yml 覆盖；无硬编码 tunable）。
 * @typedef {object} Config
 * @property {boolean} [enabled] 整体开关；false 时工具/注入/服务/审批 answerer 全部消失。
 * @property {string} [dbPath] 记忆库路径；空 = $DSH_HOME/dsh-memento/memory.db。
 * @property {{user: {userGlobal: number, workspace: number}, agent: {userGlobal: number, workspace: number}}} [budgets]
 *   每轨每层硬字符预算。
 * @property {'ask'|'auto'|'off'} [writePolicy] 写审批策略；模型不可见、不可改。
 * @property {number} [snapshotOrder] 快照段注入顺序（默认 -50，靠前负值）。
 * @property {number} [maxEntriesPerQuery] query 单次返回条目上限。
 */
export const Config = Schema.object({
  enabled: Schema.boolean().default(true),
  dbPath: Schema.string().default(''),
  budgets: Schema.object({
    user: Schema.object({
      userGlobal: Schema.number().default(DEFAULT_BUDGETS.user.userGlobal),
      workspace: Schema.number().default(DEFAULT_BUDGETS.user.workspace),
    }),
    agent: Schema.object({
      userGlobal: Schema.number().default(DEFAULT_BUDGETS.agent.userGlobal),
      workspace: Schema.number().default(DEFAULT_BUDGETS.agent.workspace),
    }),
  }),
  writePolicy: Schema.union(['ask', 'auto', 'off']).default('ask'),
  snapshotOrder: Schema.number().default(DEFAULT_SNAPSHOT_ORDER),
  maxEntriesPerQuery: Schema.number().default(20),
})

/**
 * 记忆写审批请求：service 层强制走 ctx.approval.request（waterfall 接缝）。
 * approval/asked + approval/decided（会话日志已知事件类型）由审批服务自动落盘；
 * reason 携带完整写载荷，S2"变更可自会话日志重建"由此成立。
 * @param {ApprovalLike} approval - ApprovalService。
 * @param {WritePayload} payload - {action, track, scope, text, count?}。
 * @param {AskWrite} write - {agent, callId?, signal?}。
 * @returns {Promise<string>} ApprovalOutcome。
 */
async function askApproval(approval, payload, write) {
  const request = {
    agent: write.agent,
    toolName: TOOL_NAME,
    reason: buildWriteReason(payload),
    ...(write.callId === undefined ? {} : { callId: write.callId }),
    ...(write.signal === undefined ? {} : { signal: write.signal }),
  }
  try {
    return await approval.request(request)
  } catch (error) {
    if (error instanceof MemoryError) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new WriteDeniedError('unavailable', `approval ask failed: ${message}`)
  }
}

/**
 * 自适应会话事件派发：只有 harness 已知该事件类型才 append。
 * rc.6 无插件事件注册面（KNOWN_SESSION_EVENT_TYPES 不含 memory/*，且
 * Session.append 无法标记 ignorable）：append 未注册类型会让该会话下次加载
 * 被持久化层拒绝。因此默认跳过，审计由审批审计对 + 审计表承担；未来 harness
 * 收录 memory/* 进已知集合后自动开启。
 * @param {{append?: (type: string, data: object) => unknown} | null | undefined} session - Session。
 * @param {string} type - 事件类型。
 * @param {object} data - 载荷。
 */
function maybeAppendSessionEvent(session, type, data) {
  if (session === undefined || session === null) return
  if (KNOWN_SESSION_EVENT_TYPES.has(type)) session.append(type, data)
}

/**
 * ctx.memory 服务（Service Definition 实现）。
 * 写方法内部强制过审批门：预算预检 → 审批 → 预算复审 → 落盘 → 审计。
 * 读方法无审批；禁用时本服务整体不存在。
 */
export class MemoryService {
  /**
   * @param {ServiceDeps} deps - {store, budgets, writePolicy, maxEntriesPerQuery, approval, sourceLabel}。
   */
  constructor(deps) {
    this.store = deps.store
    this.budgetsConfig = deps.budgets
    this.limits = budgetLimits(deps.budgets)
    this.writePolicy = normalizeWritePolicy(deps.writePolicy)
    this.maxEntriesPerQuery = deps.maxEntriesPerQuery
    this.approval = deps.approval
    this.sourceLabel = deps.sourceLabel ?? DEFAULT_SOURCE
  }

  /** @returns {Array<{track: string, scope: string, used: number, limit: number}>} 预算报表。 */
  budgets() {
    return budgetReport(this.store.listEntries(), this.budgetsConfig)
  }

  /**
   * 查询条目（无审批；带 sessionId 时记一条 recalled 审计）。
   * @param {{track?: string, scope?: string, text?: string, limit?: number}} [filter] - {track, scope, text, limit}。
   * @param {{sessionId?: string, session?: MemorySessionLike | null}} [opts] - {sessionId, session}；session 用于 memory/recalled
   *   事件的按已知类型自适应派发（与写事件同一 maybeAppendSessionEvent 门）。
   * @returns {MemoryQueryResult}。
   */
  query(filter = {}, opts = {}) {
    const { entries, total, truncated } = this.store.queryEntries({
      ...(filter.track === undefined ? {} : { track: filter.track }),
      ...(filter.scope === undefined ? {} : { scope: filter.scope }),
      ...(typeof filter.text === 'string' && filter.text.length > 0 ? { text: filter.text } : {}),
      limit: Number.isInteger(filter.limit) && filter.limit > 0 ? filter.limit : this.maxEntriesPerQuery,
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
      maybeAppendSessionEvent(opts.session, SESSION_EVENTS.recalled, {
        query: typeof filter.text === 'string' ? filter.text : '',
        matches: total,
        sessionId: opts.sessionId ?? opts.session.id ?? '',
      })
    }
    return { entries, total, truncated }
  }

  /**
   * 写路径审批门。默认走 ctx.approval.request（turn 内，落 approval/asked +
   * approval/decided 审计对）。write.gate 为可选自定义传输（/memory 命令在
   * turn 外使用：同一 approval/request waterfall + 同一 answerer 链裁决，
   * 会话级 never 策略由调用方预检；审计落在插件审计表 + command/done）。
   * @param {WritePayload} payload - {action, track, scope, text, count?}。
   * @param {MemoryWriteContext} write - {agent, callId?, signal?, gate?}。
   */
  async #ask(payload, write) {
    if (typeof write.gate === 'function') {
      const outcome = await write.gate(payload, write)
      this.#assertOutcome(outcome)
      return
    }
    const outcome = await askApproval(this.approval, payload, write)
    this.#assertOutcome(outcome)
  }

  /**
   * 新增条目（写：审批门 + 预算门）。
   * @param {{track: string, scope: string, text: string, source?: string, workspaceKey?: string}} input - {track, scope, text, source?, workspaceKey?}。
   * @param {MemoryWriteContext} write - {agent, callId?, signal?, gate?}；agent 缺失即失败封闭。
   * @returns {Promise<{entry: MemoryEntry, usage: {track: string, scope: string, used: number, limit: number}}>}。
   */
  async add(input, write) {
    const { track, scope, text } = this.#validateEntry(input, write)
    this.#assertBudget(track, scope, this.store.usage(track, scope), text.length)
    await this.#ask({ action: 'add', track, scope, text }, write)
    this.#throwIfAborted(write)
    // 审批等待期间用量可能变化：以此刻用量为权威复审。
    const now = this.store.usage(track, scope)
    this.#assertBudget(track, scope, now, text.length)
    const entry = this.store.insertEntry({
      track, scope, text,
      workspaceKey: input.workspaceKey ?? this.#workspaceKeyOf(write),
      source: input.source ?? this.sourceLabel,
      sessionId: write.agent.session?.id ?? null,
    })
    this.#auditWrite('add', track, scope, entry, write)
    this.#appendWriteEvent(write, SESSION_EVENTS.added, { entry, source: entry.source })
    return { entry, usage: this.#usage(track, scope) }
  }

  /**
   * 按唯一子串替换条目（写：审批门 + 预算门；零/多命中报错，绝不截断）。
   * @param {{track: string, scope: string, match: string, text: string, source?: string}} input - {track, scope, match, text, source?}。
   * @param {MemoryWriteContext} write - {agent, callId?, signal?}。
   * @returns {Promise<{previous: MemoryEntry, entry: MemoryEntry, usage: {track: string, scope: string, used: number, limit: number}}>}。
   */
  async replace(input, write) {
    const { track, scope, text } = this.#validateEntry(input, write)
    this.#assertMatch(input)
    // 审批前先定位：零/多命中在打扰用户之前就响亮失败。
    const previous = this.#resolveMatch(input, track, scope)
    const net = text.length - previous.text.length
    this.#assertBudget(track, scope, this.store.usage(track, scope), net)
    await this.#ask({ action: 'replace', track, scope, text }, write)
    this.#throwIfAborted(write)
    this.#assertBudget(track, scope, this.store.usage(track, scope), net)
    // 事务内重新定位+更新：审批期间条目可能已被并发写移除（响亮报错，不静默）。
    const replaced = this.store.replaceEntry({
      track, scope, match: input.match, text,
      sessionId: write.agent.session?.id ?? null,
    })
    this.#auditWrite('replace', track, scope, replaced.entry, write)
    this.#appendWriteEvent(write, SESSION_EVENTS.updated, {
      previous: replaced.previous,
      entry: replaced.entry,
      source: replaced.entry.source,
    })
    return { previous: replaced.previous, entry: replaced.entry, usage: this.#usage(track, scope) }
  }

  /**
   * 按唯一子串删除条目（写：审批门；零/多命中报错）。
   * @param {{track: string, scope: string, match: string}} input - {track, scope, match}。
   * @param {MemoryWriteContext} write - {agent, callId?, signal?}。
   * @returns {Promise<{entry: MemoryEntry, usage: {track: string, scope: string, used: number, limit: number}}>}。
   */
  async remove(input, write) {
    this.#assertAgent(write)
    this.#assertScope(input.track, input.scope)
    this.#assertMatch(input)
    // 审批前先定位：零/多命中在打扰用户之前就响亮失败。
    this.#resolveMatch(input, input.track, input.scope)
    await this.#ask({ action: 'remove', track: input.track, scope: input.scope, text: input.match }, write)
    this.#throwIfAborted(write)
    const removed = this.store.removeEntry({ track: input.track, scope: input.scope, match: input.match })
    this.#auditWrite('remove', input.track, input.scope, removed, write)
    this.#appendWriteEvent(write, SESSION_EVENTS.removed, { entry: removed, source: removed.source })
    return { entry: removed, usage: this.#usage(input.track, input.scope) }
  }

  /**
   * 批量种子（一次 ask 审批整个批次；dsh-claude-move 等插件喂数据用）。
   * 任一条超预算 → 整批拒绝（先全量预检再落盘，无部分写入）。
   * @param {Array<{track: string, scope: string, text: string, source?: string, workspaceKey?: string}>} inputs - 条目数组（track/scope/text/source/workspaceKey）。
   * @param {MemoryWriteContext} write - {agent, callId?, signal?}。
   * @returns {Promise<{added: number, entries: MemoryEntry[]}>}。
   */
  async seed(inputs, write) {
    this.#assertAgent(write)
    if (!Array.isArray(inputs) || inputs.length === 0) {
      throw new InvalidInputError('seed requires a non-empty entry list')
    }
    const normalized = inputs.map((input) => {
      const { track, scope, text } = this.#validateEntry(input, write)
      return {
        track, scope, text,
        source: input.source ?? this.sourceLabel,
        workspaceKey: input.workspaceKey ?? this.#workspaceKeyOf(write),
      }
    })
    const summary = normalized.map((entry) => `${entry.track}/${entry.scope}: ${entry.text}`).join('\n')
    await this.#ask({
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
    const entries = normalized.map((entry) => this.store.insertEntry({ ...entry, sessionId }))
    this.store.auditAppend({
      action: 'seed',
      track: null, scope: null, entryId: null,
      text: summary, outcome: `allowed-once (policy ${this.writePolicy})`,
      source: this.sourceLabel, sessionId,
    })
    for (const entry of entries) {
      this.#auditWrite('add', entry.track, entry.scope, entry, write)
      this.#appendWriteEvent(write, SESSION_EVENTS.added, { entry, source: entry.source })
    }
    return { added: entries.length, entries }
  }

  /** 写路径必须有 agent（审批路由与审计归属）：缺失即失败封闭。 */
  #assertAgent(/** @type {MemoryWriteContext} */ write) {
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

  /** 条目公共校验：agent + scope + 非空文本。 */
  #validateEntry(/** @type {{track: string, scope: string, text: string}} */ input, /** @type {MemoryWriteContext} */ write) {
    this.#assertAgent(write)
    this.#assertScope(input.track, input.scope)
    if (typeof input.text !== 'string' || input.text.length === 0) {
      throw new InvalidInputError('entry text must be a non-empty string')
    }
    return { track: input.track, scope: input.scope, text: input.text }
  }

  /** 审批前定位替换/删除目标（唯一子串语义，零/多命中结构化报错）。 */
  #resolveMatch(/** @type {{match: string}} */ input, /** @type {string} */ track, /** @type {string} */ scope) {
    const hits = /** @type {Array<{text: string}>} */ (this.store.queryEntries({ track, scope, text: input.match }).entries)
      .filter((entry) => entry.text.includes(input.match))
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

  /** 写成功的审计行（含审批来源与策略）。 */
  #auditWrite(/** @type {string} */ action, /** @type {string} */ track, /** @type {string} */ scope, /** @type {MemoryEntry} */ entry, /** @type {MemoryWriteContext} */ write) {
    this.store.auditAppend({
      action,
      track,
      scope,
      entryId: entry.id,
      text: entry.text,
      outcome: `allowed-once (policy ${this.writePolicy})`,
      source: entry.source,
      sessionId: write.agent.session?.id ?? null,
    })
  }

  /** 写事件自适应派发（带上写方会话）。 */
  #appendWriteEvent(/** @type {MemoryWriteContext} */ write, /** @type {string} */ type, /** @type {object} */ data) {
    const sessionId = write.agent.session?.id ?? ''
    maybeAppendSessionEvent(write.agent.session, type, { ...data, sessionId })
  }

  /** (track, scope) 用量与上限（工具结果回带，模型据此整合重试）。 */
  #usage(/** @type {string} */ track, /** @type {string} */ scope) {
    return { track, scope, used: this.store.usage(track, scope), limit: this.limits[/** @type {'user'|'agent'} */ (track)][/** @type {'user-global'|'workspace'} */ (scope)] }
  }

  /** @param {{agent?: {session?: MemorySessionLike | null} | null}} write - {agent}。 */
  #workspaceKeyOf(write) {
    return workspaceKeyOf(/** @type {string | undefined} */ (write.agent?.session?.header?.cwd))
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

/** 工具结果里的固定错误形状（schema additionalProperties:false 需要显式字段）。 */
function toToolError(/** @type {unknown} */ error) {
  if (error instanceof MemoryError) {
    const { code, message, ...details } = error.toPublic()
    return {
      code,
      message,
      ...(details.outcome === undefined ? {} : { outcome: details.outcome }),
      ...(details.used === undefined ? {} : { usage: { track: details.track, scope: details.scope, used: details.used, limit: details.limit } }),
      ...(details.candidates === undefined ? {} : { candidates: details.candidates }),
      ...(details.sample === undefined ? {} : { sample: details.sample }),
    }
  }
  return { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) }
}

/** 记忆工具描述：内嵌 Save/Skip 行为指引（学 Hermes 官方 memory.md 清单）。 */
const MEMORY_TOOL_DESCRIPTION = [
  'Read and write the bounded, layered, approval-gated cross-session memory store (dsh-memento).',
  '',
  'Tracks: "user" holds facts about the user (preferences, communication style, landmines, corrections); "agent" holds environment facts, project conventions, lessons learned, and completed-work summaries. Layers: "user-global" applies to every workspace; "workspace" applies only to the current working directory.',
  '',
  'Each track/layer pair has a hard character budget (shown in the session memory snapshot header). A write that would exceed it FAILS with a structured error carrying current usage and the limit — consolidate or remove entries, then retry. Never truncate or silently drop content.',
  '',
  'SAVE: user preferences and corrections; environment facts and project conventions; lessons learned from mistakes; summaries of completed work; anything the user explicitly asks you to remember.',
  'SKIP: trivial or re-derivable facts; encyclopedia knowledge a fresh search can answer; large data dumps or logs; one-off file paths; content already available in the current workspace.',
  '',
  'Writes (add/replace/remove) require approval under the configured policy and are audited; reads (query) are free. replace/remove target an entry by a UNIQUE case-sensitive substring — an ambiguous match fails with the candidate list, so use a longer substring. Each session receives a frozen snapshot of current memory at startup; the snapshot never changes mid-session.',
].join('\n')

/**
 * memory 工具定义（Consumer）。execute 尊重 exec.signal；领域失败返回
 * ok:false + 结构化 error，基础设施失败才抛出（isError）。
 * @param {MemoryService} service - ctx.memory。
 * @returns {object} 工具定义。
 */
export function makeMemoryTool(service) {
  return defineTool({
    name: 'memory',
    description: MEMORY_TOOL_DESCRIPTION,
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['add', 'replace', 'remove', 'query'],
        description: 'add = insert a new entry; replace = rewrite one existing entry; remove = delete one existing entry; query = substring search over existing entries.',
      },
      track: {
        type: 'string',
        enum: ['user', 'agent'],
        description: 'Memory track. Defaults to "user". user = facts about the user; agent = environment/project facts and conventions.',
      },
      scope: {
        type: 'string',
        enum: ['user-global', 'workspace'],
        description: 'Layer. Defaults to "workspace". user-global applies to every workspace; workspace applies only to this working directory.',
      },
      text: {
        type: 'string',
        description: 'add/replace: the exact entry text. query: case-sensitive substring filter.',
      },
      match: {
        type: 'string',
        description: 'replace/remove: a UNIQUE case-sensitive substring of the existing entry to target.',
      },
      limit: {
        type: 'integer',
        description: 'query: maximum entries to return (default 20).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true, enum: ['add', 'replace', 'remove', 'query'] },
          ok: { type: 'boolean', required: true },
          entry: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              track: { type: 'string', required: true },
              scope: { type: 'string', required: true },
              text: { type: 'string', required: true },
              source: { type: 'string', required: true },
            },
          },
          previous: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              text: { type: 'string', required: true },
            },
          },
          entries: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                track: { type: 'string', required: true },
                scope: { type: 'string', required: true },
                text: { type: 'string', required: true },
                source: { type: 'string', required: true },
              },
            },
          },
          total: { type: 'integer' },
          truncated: { type: 'boolean' },
          usage: {
            type: 'object',
            additionalProperties: false,
            properties: {
              track: { type: 'string', required: true },
              scope: { type: 'string', required: true },
              used: { type: 'integer', required: true },
              limit: { type: 'integer', required: true },
            },
          },
          error: {
            type: 'object',
            additionalProperties: false,
            properties: {
              code: { type: 'string', required: true },
              message: { type: 'string', required: true },
              outcome: { type: 'string' },
              usage: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  track: { type: 'string', required: true },
                  scope: { type: 'string', required: true },
                  used: { type: 'integer', required: true },
                  limit: { type: 'integer', required: true },
                },
              },
              candidates: { type: 'integer' },
              sample: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      render: renderMemoryResult,
    },
    execute: /** @type {(args: any, exec: any) => Promise<any>} */ (async (args, exec) => {
      exec.signal.throwIfAborted()
      const write = {
        agent: exec.agent,
        ...(exec.callId === undefined ? {} : { callId: exec.callId }),
        signal: exec.signal,
      }
      try {
        switch (args.action) {
          case 'query': {
            const result = service.query(
              {
                ...(args.track === undefined ? {} : { track: args.track }),
                ...(args.scope === undefined ? {} : { scope: args.scope }),
                ...(args.text === undefined ? {} : { text: args.text }),
                ...(args.limit === undefined ? {} : { limit: args.limit }),
              },
              { sessionId: exec.agent?.session?.id, session: exec.agent?.session },
            )
            return {
              action: 'query',
              ok: true,
              entries: result.entries.map(publicEntry),
              total: result.total,
              truncated: result.truncated,
            }
          }
          case 'add': {
            const result = await service.add(
              {
                track: args.track ?? 'user',
                scope: args.scope ?? 'workspace',
                text: args.text,
                source: 'memory-tool',
              },
              write,
            )
            return { action: 'add', ok: true, entry: publicEntry(result.entry), usage: result.usage }
          }
          case 'replace': {
            const result = await service.replace(
              {
                track: args.track ?? 'user',
                scope: args.scope ?? 'workspace',
                match: args.match,
                text: args.text,
                source: 'memory-tool',
              },
              write,
            )
            return {
              action: 'replace',
              ok: true,
              entry: publicEntry(result.entry),
              previous: { id: result.previous.id, text: result.previous.text },
              usage: result.usage,
            }
          }
          case 'remove': {
            const result = await service.remove(
              {
                track: args.track ?? 'user',
                scope: args.scope ?? 'workspace',
                match: args.match,
              },
              write,
            )
            return { action: 'remove', ok: true, entry: publicEntry(result.entry), usage: result.usage }
          }
          default: {
            throw new InvalidInputError(`unknown memory action ${JSON.stringify(args.action)}`)
          }
        }
      } catch (error) {
        if (error instanceof MemoryError) {
          return { action: args.action, ok: false, error: toToolError(error) }
        }
        throw error
      }
    }),
  })
}

/** 工具结果里的公开条目投影（只带声明过的字段）。 */
function publicEntry(/** @type {MemoryEntry} */ entry) {
  return {
    id: entry.id,
    track: entry.track,
    scope: entry.scope,
    text: entry.text,
    source: entry.source,
  }
}

/**
 * 工具结果渲染（纯函数）。
 * @param {object} _args - 调用参数（未用）。
 * @param {object} value - 规范 JSON 结果。
 * @returns {Array<{type: 'text', text: string}>} 模型可见文本。
 */
export function renderMemoryResult(/** @type {object} */ _args, /** @type {MemoryToolValue} */ value) {
  if (!value.ok) {
    return [{ type: 'text', text: `memory ${value.action} failed: ${value.error.message}` }]
  }
  switch (value.action) {
    case 'query':
      return [{
        type: 'text',
        text: value.entries.length === 0
          ? 'memory query: no entries matched'
          : `memory query: ${value.entries.length} match${value.entries.length === 1 ? '' : 'es'}${value.truncated ? ` (of ${value.total} total; refine the filter for more)` : ''}\n${value.entries.map((entry) => `- [${entry.track}/${entry.scope}] ${entry.text}`).join('\n')}`,
      }]
    case 'add':
      return [{ type: 'text', text: `memory entry added (${value.entry.track}/${value.entry.scope}): ${value.entry.text}\nbudget: ${value.usage.used}/${value.usage.limit} chars used` }]
    case 'replace':
      return [{ type: 'text', text: `memory entry replaced (${value.entry.track}/${value.entry.scope}): ${value.entry.text}\nbudget: ${value.usage.used}/${value.usage.limit} chars used` }]
    case 'remove':
      return [{ type: 'text', text: `memory entry removed (${value.entry.track}/${value.entry.scope}): ${value.entry.text}\nbudget: ${value.usage.used}/${value.usage.limit} chars used` }]
    default:
      return [{ type: 'text', text: `memory ${value.action}: ok` }]
  }
}

/**
 * 插件挂载。enabled:false 时不注册任何东西（工具/注入/服务/审批 answerer
 * 整体消失，不留半残状态）；库损坏/迁移失败/非法配置在加载期响亮抛错（S5）。
 * 缺省字段在此显式补默认（与 Config schema 的默认值同源，DEFAULT_* 常量）。
 * @param {import('@deepseek-ai/cordis').Context} ctx - Cordis 上下文。
 * @param {object} config - 插件配置（cordis loader 已套 schema 默认值）。
 */
export function apply(ctx, /** @type {PluginConfig} */ config = {}) {
  const resolved = {
    enabled: config.enabled ?? true,
    dbPath: config.dbPath ?? '',
    budgets: {
      user: {
        userGlobal: config.budgets?.user?.userGlobal ?? DEFAULT_BUDGETS.user.userGlobal,
        workspace: config.budgets?.user?.workspace ?? DEFAULT_BUDGETS.user.workspace,
      },
      agent: {
        userGlobal: config.budgets?.agent?.userGlobal ?? DEFAULT_BUDGETS.agent.userGlobal,
        workspace: config.budgets?.agent?.workspace ?? DEFAULT_BUDGETS.agent.workspace,
      },
    },
    writePolicy: config.writePolicy ?? 'ask',
    snapshotOrder: config.snapshotOrder ?? DEFAULT_SNAPSHOT_ORDER,
    maxEntriesPerQuery: config.maxEntriesPerQuery ?? 20,
  }
  if (resolved.enabled === false) return
  const budgetCheck = validateBudgets(resolved.budgets)
  if (!budgetCheck.ok) throw new InvalidInputError(`dsh-memento config: ${/** @type {{message: string}} */ (budgetCheck).message}`)
  normalizeWritePolicy(resolved.writePolicy)
  if (!Number.isFinite(resolved.snapshotOrder)) {
    throw new InvalidInputError('dsh-memento config: snapshotOrder must be a finite number')
  }
  if (!Number.isInteger(resolved.maxEntriesPerQuery) || resolved.maxEntriesPerQuery <= 0) {
    throw new InvalidInputError('dsh-memento config: maxEntriesPerQuery must be a positive integer')
  }
  const dbPath = resolveDbPath(resolved.dbPath)
  const store = openMemoryStore(dbPath)
  const service = new MemoryService({
    store,
    budgets: resolved.budgets,
    writePolicy: resolved.writePolicy,
    maxEntriesPerQuery: resolved.maxEntriesPerQuery,
    approval: ctx.approval,
    sourceLabel: DEFAULT_SOURCE,
  })

  ctx.provide('memory', service)
  ctx.effect(() => () => store.close(), 'dsh-memento.store.close')

  // 审批 answerer：认领本插件的记忆写请求并按 writePolicy 裁决（prepend 保证
  // auto/off 的确定性先于 UI answerer；会话级 never 策略在审批服务内部先裁决，
  // 任何 answerer 都无法绕过）。
  ctx.on('approval/request', async function answerer(req, next) {
    if (!isMemoryWriteRequest(req)) return next()
    return applyWritePolicy(resolved.writePolicy, req, next)
  }, { prepend: true })

  ctx.tools.register(/** @type {import('@deepseek-ai/dsh-tools').ToolDefinition} */ (makeMemoryTool(service)))

  // 冻结快照注入：会话首个 assemble 时同步读库渲染，WeakMap 按 Session 冻结。
  // 提供者必须同步（rc.6 不 await systemPrompt 提供者），SQLite 同步读满足。
  // 渲染文本同时进入 request/header（system 字段）→ 可自会话日志重建（S2）。
  const snapshots = new WeakMap()
  ctx.systemPrompt.section({
    name: 'dsh-memento:memory',
    order: resolved.snapshotOrder,
    text: (assemble) => {
      // rc.6 实测路径：assemble 携带 agent（AssembleContext 声明面未含该字段），收窄处理。
      const context = /** @type {{agent?: {session?: MemorySessionLike | null} | null} | null | undefined} */ (assemble)
      const agent = context?.agent
      const session = agent?.session
      if (session === undefined || session === null) return ''
      let frozen = snapshots.get(session)
      if (frozen === undefined) {
        const workspaceKey = workspaceKeyOf(/** @type {string | undefined} */ (session.header?.cwd))
        const entries = visibleEntries(
          /** @type {Array<{id: string, track: string, scope: string, workspaceKey: string, text: string, createdAt: number}>} */ (store.listEntries()),
          workspaceKey,
        )
        frozen = renderSnapshot(entries, resolved.budgets)
        snapshots.set(session, frozen)
        store.auditAppend({
          action: 'snapshot',
          track: null,
          scope: null,
          entryId: null,
          text: frozen,
          outcome: 'ok',
          source: DEFAULT_SOURCE,
          sessionId: /** @type {string | null} */ (session.id ?? null),
        })
        maybeAppendSessionEvent(session, SESSION_EVENTS.snapshot, {
          text: frozen,
          workspaceKey,
          at: Date.now(),
        })
      }
      return frozen
    },
  })

  // V2 观察面：/memory 命令（用户触发）、memory_recall 工具、面板 JSON 路由。
  // commands/webServer 为可选服务，缺失（headless）自动跳过。
  registerCommands(ctx, service)
  ctx.tools.register(/** @type {import('@deepseek-ai/dsh-tools').ToolDefinition} */ (makeMemoryRecallTool(service, ctx)))
  registerWebRoutes(ctx, service)
}

// ── V2 观察面 ────────────────────────────────────────────────────────────────

/**
 * 可选服务就绪即调用（服务缺失时跳过，不保持 PENDING）。apply 时已存在则
 * 立即调用；否则订阅 internal/service 事件，服务出现时再调用。
 * @param {import('@deepseek-ai/cordis').Context} ctx - Cordis 上下文。
 * @param {string} serviceName - 服务名。
 * @param {(service: unknown) => void} fn - 就绪回调。
 */function withService(ctx, serviceName, fn) {
  const existing = ctx.get(serviceName)
  if (existing !== undefined && existing !== null) {
    fn(existing)
    return
  }
  const off = ctx.on('internal/service', (name) => {
    if (name !== serviceName) return
    const service = ctx.get(serviceName)
    if (service !== undefined && service !== null) {
      off()
      fn(service)
    }
  })
}

/**
 * turn 外的写审批门（/memory 命令用）。走同一 approval/request waterfall 与
 * 同一 answerer 链（writePolicy 在此应用）；与 turn 内路径的差异：审批服务
 * 的 approval/asked + approval/decided 审计对要求 open turn，turn 外无审计
 * 对可落——审计由插件审计表 + command/done 承担。会话级 never 策略在派发前
 * 由本函数按公开 API 预检（与审批服务同语义）。
 * @param {import('@deepseek-ai/cordis').Context} ctx - Cordis 上下文。
 * @param {{agent?: {session?: MemorySessionLike | null} | null}} write - {agent}。
 * @returns {(payload: WritePayload) => Promise<string>} gate 函数。
 */
function makeCommandGate(ctx, write) {
  return async (payload) => {
    const approval = ctx.approval
    const session = write.agent?.session
    const sessionPolicy = typeof approval?.overrideOf === 'function' && session !== undefined
      ? approval.overrideOf(session)
      : undefined
    const effective = sessionPolicy ?? approval?.config?.policy ?? 'ask'
    if (effective === 'never') {
      return 'rejected' // 会话级 never 不可绕过（与审批服务同语义的预检）
    }
    return ctx.waterfall('approval/request', {
      agent: write.agent,
      toolName: TOOL_NAME,
      reason: buildWriteReason(payload),
    }, async () => 'unavailable')
  }
}

/**
 * 注册 /memory 命令（用户触发，非模型回合）。列出/查询/预算/审计直接读；
 * add/remove 走 turn 外审批门（同一 waterfall + writePolicy）。命令缺失的
 * profile（headless）自动跳过。
 * @param {import('@deepseek-ai/cordis').Context} ctx - Cordis 上下文。
 * @param {MemoryService} service - ctx.memory。
 */
export function registerCommands(ctx, service) {
  withService(ctx, 'commands', (/** @type {{register?: (def: object) => unknown} | null | undefined} */ commands) => {
    if (typeof commands?.register !== 'function') return
    commands.register({
      name: 'memory',
      description: '查看/管理 dsh-memento 记忆：list | query <词> | add [--track=user|agent] [--scope=user-global|workspace] <文本> | remove <唯一子串> | budgets | audit',
      input: { hint: 'list | query <词> | add <文本> | remove <唯一子串> | budgets | audit' },
      handler: async (/** @type {{rawInput?: unknown, agent?: unknown, signal?: AbortSignal}} */ invocation) => handleMemoryCommand(ctx, service, invocation),
    })
  })
}

/**
 * /memory 命令处理器（导出供测试；自身捕获领域错误，返回规范结果）。
 * @param {import('@deepseek-ai/cordis').Context} ctx - Cordis 上下文。
 * @param {MemoryService} service - ctx.memory。
 * @param {object} invocation - {rawInput, agent, signal}。
 * @returns {Promise<{kind: 'success'|'error', text: string}>}。
 */
export async function handleMemoryCommand(ctx, service, /** @type {{rawInput?: unknown, agent?: {session?: MemorySessionLike | null} | null, signal?: AbortSignal}} */ invocation) {
  try {
    return await runMemoryCommand(ctx, service, invocation)
  } catch (error) {
    if (error instanceof MemoryError) return { kind: 'error', text: `memory ${String(error.code)}: ${error.message}` }
    const message = error instanceof Error ? error.message : String(error)
    return { kind: 'error', text: `memory 命令失败：${message}` }
  }
}

/**
 * handleMemoryCommand 的裸实现（错误由外层包装）。
 * @param {import('@deepseek-ai/cordis').Context} ctx - Cordis 上下文。
 * @param {MemoryService} service - ctx.memory。
 * @param {{rawInput?: unknown, agent?: {session?: MemorySessionLike | null} | null, signal?: AbortSignal}} invocation - {rawInput, agent, signal}。
 * @returns {Promise<{kind: 'success' | 'error', text: string}>}。
 */
async function runMemoryCommand(ctx, service, invocation) {
  const raw = String(invocation?.rawInput ?? '').trim()
  const [verb, ...rest] = raw.split(/\s+/)
  if (verb === undefined || verb.length === 0) {
    return { kind: 'success', text: '用法：/memory list | query <词> | add <文本> | remove <唯一子串> | budgets | audit' }
  }
  switch (verb) {
    case 'list': {
      const { entries, total } = service.query({}, { sessionId: /** @type {string | undefined} */ (invocation?.agent?.session?.id), session: invocation?.agent?.session })
      if (total === 0) return { kind: 'success', text: '记忆为空。' }
      return { kind: 'success', text: `记忆条目（${total} 条）：\n${entries.map(renderEntryLine).join('\n')}` }
    }
    case 'query': {
      const text = rest.join(' ')
      if (text.length === 0) return { kind: 'error', text: 'query 需要一个关键词：/memory query <词>' }
      const { entries, total, truncated } = service.query({ text }, { sessionId: /** @type {string | undefined} */ (invocation?.agent?.session?.id), session: invocation?.agent?.session })
      if (total === 0) return { kind: 'success', text: `没有条目包含「${text}」。` }
      return { kind: 'success', text: `命中 ${total} 条${truncated ? '（已截断）' : ''}：\n${entries.map(renderEntryLine).join('\n')}` }
    }
    case 'budgets': {
      const rows = service.budgets()
      return { kind: 'success', text: `预算用量：\n${rows.map((/** @type {{track: string, scope: string, used: number, limit: number}} */ row) => `- ${row.track}/${row.scope}: ${row.used}/${row.limit}`).join('\n')}` }
    }
    case 'audit': {
      const limit = 10
      const rows = service.store.auditList(limit)
      if (rows.length === 0) return { kind: 'success', text: '审计为空。' }
      return { kind: 'success', text: `最近审计（${rows.length} 条）：\n${rows.map((/** @type {{ts: number, action: string, track?: string | null, scope?: string | null, outcome?: string | null, source?: string | null}} */ row) => `- ${new Date(row.ts).toISOString()} ${row.action}${row.track ? ` ${row.track}/${row.scope}` : ''} ${row.outcome ?? ''} (${row.source ?? ''})`.trim()).join('\n')}` }
    }
    case 'add': {
      const parsed = parseCommandWrite(rest, true)
      if (parsed.kind === 'error') {
        return { kind: 'error', text: 'add 需要文本：/memory add [--track=user|agent] [--scope=user-global|workspace] <文本>' }
      }
      const write = { agent: invocation?.agent, gate: makeCommandGate(ctx, invocation) }
      const result = await service.add(
        { track: parsed.track, scope: parsed.scope, text: parsed.text, source: 'command' },
        write,
      )
      return { kind: 'success', text: `已添加（${parsed.track}/${parsed.scope}）：${result.entry.text}\n该层用量：${result.usage.used}/${result.usage.limit}` }
    }
    case 'remove': {
      const parsed = parseCommandWrite(rest, true)
      if (parsed.kind === 'error') return { kind: 'error', text: `remove 需要一个唯一子串：/memory remove [--track=user|agent] [--scope=user-global|workspace] <唯一子串>` }
      const result = await service.remove(
        { track: parsed.track, scope: parsed.scope, match: parsed.text },
        { agent: invocation?.agent, gate: makeCommandGate(ctx, invocation) },
      )
      return { kind: 'success', text: `已删除（${parsed.track}/${parsed.scope}）：${result.entry.text}\n该层用量：${result.usage.used}/${result.usage.limit}` }
    }
    default:
      return { kind: 'error', text: `未知子命令「${verb}」。用法：/memory list | query <词> | add <文本> | remove <唯一子串> | budgets | audit` }
  }
}

/** 命令写参数解析：--track/--scope 可选（默认 user/workspace，与工具一致），余下为文本。 */
function parseCommandWrite(/** @type {string[]} */ args, /** @type {boolean} */ requireText) {
  let track = 'user'
  let scope = 'workspace'
  const textParts = []
  for (const arg of args) {
    const trackMatch = /^--track=(user|agent)$/.exec(arg)
    if (trackMatch !== null) { track = trackMatch[1]; continue }
    const scopeMatch = /^--scope=(user-global|workspace)$/.exec(arg)
    if (scopeMatch !== null) { scope = scopeMatch[1]; continue }
    textParts.push(arg)
  }
  const text = textParts.join(' ')
  if (requireText === true && text.length === 0) {
    return { kind: 'error', text: '需要文本参数' }
  }
  return { kind: 'ok', track, scope, text }
}

/** 条目渲染行（命令/面板共用格式）。 */
function renderEntryLine(/** @type {{track: string, scope: string, workspaceKey?: string, text: string}} */ entry) {
  return `- [${entry.track}/${entry.scope}${entry.scope === 'workspace' ? ` @${entry.workspaceKey}` : ''}] ${entry.text}`
}

/**
 * memory_recall 工具（F11）：语义不明确时把记忆 query 与近期会话历史合并
 * 返回两段式召回（"记忆 + 历史会话"）。sessionQuery 服务缺失时降级为纯记忆
 * 结果（history 段为空，绝不报错）。
 * @param {MemoryService} service - ctx.memory。
 * @param {import('@deepseek-ai/cordis').Context} ctx - Cordis 上下文（查 sessionQuery）。
 * @returns {object} 工具定义。
 */
export function makeMemoryRecallTool(service, ctx) {
  return defineTool({
    name: 'memory_recall',
    description: [
      'Two-part recall over memory and session history: returns (1) bounded memory entries matching the query from the dsh-memento store, and (2) recent session-history matches via the session-query service.',
      'Use when a memory query alone is ambiguous or when the answer may live in an earlier conversation rather than in memory. For plain memory lookup prefer the memory tool with action=query.',
    ].join('\n'),
    parameters: {
      query: { type: 'string', required: true, description: 'Case-insensitive search terms for both sources.' },
      memoryLimit: { type: 'integer', description: 'Max memory entries to return (default 10).' },
      historyLimit: { type: 'integer', description: 'Max history sessions to scan (default 8).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          memory: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              entries: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string', required: true },
                    track: { type: 'string', required: true },
                    scope: { type: 'string', required: true },
                    text: { type: 'string', required: true },
                  },
                },
              },
              total: { type: 'integer', required: true },
              truncated: { type: 'boolean', required: true },
            },
          },
          history: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              available: { type: 'boolean', required: true },
              error: { type: 'string' },
              sessions: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    sessionId: { type: 'string', required: true },
                    matches: { type: 'integer', required: true },
                    snippets: { type: 'array', required: true, items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
      render: renderMemoryRecallResult,
    },
    execute: /** @type {(args: any, exec: any) => Promise<any>} */ (async (args, exec) => {
      exec.signal.throwIfAborted()
      const memory = service.query(
        { text: args.query, limit: args.memoryLimit ?? 10 },
        { sessionId: exec.agent?.session?.id, session: exec.agent?.session },
      )
      const history = await recallHistory(ctx, args.query, args.historyLimit ?? 8, exec.signal)
      return {
        ok: true,
        memory: {
          entries: memory.entries.map(publicEntry),
          total: memory.total,
          truncated: memory.truncated,
        },
        history,
      }
    }),
  })
}

/**
 * 近期会话历史召回（sessionQuery 可选；rc.6 记录形状 = {header:{id}}，事件为元数据记录）。
 * @param {import('@deepseek-ai/cordis').Context} ctx - Cordis 上下文（查 sessionQuery）。
 * @param {string} query - 检索词。
 * @param {number} limit - 最多扫描的会话数。
 * @param {AbortSignal} signal - 取消信号。
 * @returns {Promise<{available: boolean, sessions: Array<{sessionId: string, matches: number, snippets: string[]}>, error?: string}>}。
 */
async function recallHistory(ctx, query, limit, signal) {
  const sessionQuery = ctx.get('sessionQuery')
  if (sessionQuery === undefined || sessionQuery === null) {
    return { available: false, sessions: [] }
  }
  const queryService = /** @type {{filterSessions: (filters: object[], signal?: AbortSignal) => Promise<Array<{header?: {id?: unknown}}>>, filterEvents: (sessionId: string, filters: object[]) => Promise<Array<{seq: number}>>, readSession: (sessionId: string) => Promise<{session?: unknown, events: Array<{seq: number, type?: string, data?: unknown}>}>}} */ (sessionQuery)
  try {
    const records = await queryService.filterSessions([], signal)
    /** @type {Array<{sessionId: string, matches: number, snippets: string[]}>} */
    const results = []
    for (const record of records.slice(0, limit)) {
      const sessionId = typeof record?.header?.id === 'string' ? record.header.id : ''
      if (sessionId.length === 0) continue
      const matched = await queryService.filterEvents(sessionId, [{ kind: 'text', text: query }])
      if (matched.length === 0) continue
      // 事件记录是元数据（seq/type/time），片段文本从整段日志按 seq 抽取。
      const snippets = []
      try {
        const snapshot = await queryService.readSession(sessionId)
        const bySeq = new Map(snapshot.events.map((event) => [event.seq, event]))
        for (const hit of matched.slice(0, 5)) {
          const event = bySeq.get(hit.seq)
          if (event === undefined) continue
          const text = extractEventText(event)
          if (text.length > 0) snippets.push(text.length > 300 ? `${text.slice(0, 300)}…` : text)
        }
      } catch {
        // 片段提取失败不影响已确认的命中记录；空 catch 语义：只放弃片段装饰。
      }
      results.push({ sessionId, matches: matched.length, snippets })
    }
    return { available: true, sessions: results }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { available: false, sessions: [], error: message }
  }
}

/**
 * memory_recall 结果渲染（纯函数）。
 * @param {object} _args - 调用参数（未用）。
 * @param {object} value - 规范 JSON 结果。
 * @returns {Array<{type: 'text', text: string}>} 模型可见文本。
 */
export function renderMemoryRecallResult(/** @type {object} */ _args, /** @type {RecallToolValue} */ value) {
  const memoryLine = value.memory.total === 0
    ? 'memory: no entries matched'
    : `memory: ${value.memory.entries.length} match${value.memory.entries.length === 1 ? '' : 'es'}${value.memory.truncated ? ` (of ${value.memory.total})` : ''}\n${value.memory.entries.map((entry) => `- [${entry.track}/${entry.scope}] ${entry.text}`).join('\n')}`
  const historyLines = []
  if (!value.history.available) {
    historyLines.push(value.history.error === undefined
      ? 'history: session-query unavailable in this profile'
      : `history: session-query failed (${value.history.error})`)
  } else if (value.history.sessions.length === 0) {
    historyLines.push('history: no matching sessions')
  } else {
    for (const session of value.history.sessions) {
      historyLines.push(`- session ${session.sessionId}: ${session.matches} event match${session.matches === 1 ? '' : 'es'}`)
      for (const snippet of session.snippets) historyLines.push(`    ${snippet.replaceAll('\n', ' ')}`)
    }
  }
  return [{ type: 'text', text: `${memoryLine}\n\n${historyLines.join('\n')}` }]
}

/**
 * 注册面板 JSON 路由（F9，只读；webServer 缺失的 profile 自动跳过）。
 * 写操作（含审批）不进面板路由：审批在 DSH 内置审批 UI 完成，面板只做
 * 条目浏览/搜索/预算条/审计尾。路由随插件生命周期自动撤销。
 * @param {import('@deepseek-ai/cordis').Context} ctx - Cordis 上下文。
 * @param {MemoryService} service - ctx.memory。
 */
export function registerWebRoutes(ctx, service) {
  withService(ctx, 'webServer', (/** @type {{register?: (route: object) => unknown} | null | undefined} */ webServer) => {
    if (typeof webServer?.register !== 'function') return
    webServer.register({
      kind: 'exact',
      path: '/api/memento/entries',
      handler: async (/** @type {{url?: string}} */ req, /** @type {PanelResponse} */ res) => {
        try {
          const url = new URL(req.url ?? '', 'http://localhost')
          const filter = {
            ...(url.searchParams.get('text') ? { text: url.searchParams.get('text') } : {}),
            ...(url.searchParams.get('track') ? { track: url.searchParams.get('track') } : {}),
            ...(url.searchParams.get('scope') ? { scope: url.searchParams.get('scope') } : {}),
          }
          const rawParam = url.searchParams.get('limit')
          const raw = rawParam === null ? undefined : Number(rawParam)
          const limit = raw === undefined ? undefined : (Number.isInteger(raw) && raw > 0 ? Math.min(raw, 200) : undefined)
          const { entries, total, truncated } = service.query({
            ...filter,
            ...(limit === undefined ? {} : { limit }),
          })
          sendPanelJson(res, 200, { entries, total, truncated, budgets: service.budgets() })
        } catch (error) {
          sendPanelJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    })
    webServer.register({
      kind: 'exact',
      path: '/api/memento/audit',
      handler: async (/** @type {{url?: string}} */ req, /** @type {PanelResponse} */ res) => {
        try {
          const url = new URL(req.url ?? '', 'http://localhost')
          const raw = Number(url.searchParams.get('limit') ?? '20')
          const limit = Number.isInteger(raw) && raw > 0 && raw <= 200 ? raw : 20
          sendPanelJson(res, 200, { rows: service.store.auditList(limit) })
        } catch (error) {
          sendPanelJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    })
  })
}

/** 面板 JSON 响应（node:http）。 */
function sendPanelJson(/** @type {PanelResponse} */ res, /** @type {number} */ status, /** @type {unknown} */ value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

export { MemoryError, InvalidInputError, BudgetExceededError, EntryNotFoundError, AmbiguousMatchError, WriteDeniedError, NoAgentError }
export { buildWriteReason, isMemoryWriteRequest, applyWritePolicy, normalizeWritePolicy }
export { openMemoryStore, resolveDbPath }
export { renderSnapshot, visibleEntries }
export { workspaceKeyOf }
export { validateBudgets, budgetReport, budgetLimits, checkBudget }
