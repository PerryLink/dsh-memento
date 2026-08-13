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
  errorToPublic,
} from './lib/errors.mjs'
import { checkBudget, budgetReport, budgetLimits, validateBudgets } from './lib/budget.mjs'
import { buildWriteReason, isMemoryWriteRequest, applyWritePolicy, normalizeWritePolicy } from './lib/gate.mjs'
import { renderSnapshot, visibleEntries } from './lib/snapshot.mjs'
import { openMemoryStore, resolveDbPath } from './lib/store.mjs'
import { workspaceKeyOf } from './lib/workspace.mjs'

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
 * @param {object} approval - ApprovalService。
 * @param {object} payload - {action, track, scope, text, count?}。
 * @param {object} write - {agent, callId?, signal?}。
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
 * @param {object|undefined} session - Session。
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
   * @param {object} deps - {store, budgets, writePolicy, maxEntriesPerQuery, approval, sourceLabel}。
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
   * @param {object} [filter] - {track, scope, text, limit}。
   * @param {object} [opts] - {sessionId}。
   * @returns {{entries: object[], total: number, truncated: boolean}}。
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
    return { entries, total, truncated }
  }

  /**
   * 新增条目（写：审批门 + 预算门）。
   * @param {object} input - {track, scope, text, source?, workspaceKey?}。
   * @param {object} write - {agent, callId?, signal?}；agent 缺失即失败封闭。
   * @returns {Promise<{entry: object, usage: object}>}。
   */
  async add(input, write) {
    const { track, scope, text } = this.#validateEntry(input, write)
    this.#assertBudget(track, scope, this.store.usage(track, scope), text.length)
    const outcome = await askApproval(this.approval, { action: 'add', track, scope, text }, write)
    this.#assertOutcome(outcome)
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
   * @param {object} input - {track, scope, match, text, source?}。
   * @param {object} write - {agent, callId?, signal?}。
   * @returns {Promise<{previous: object, entry: object, usage: object}>}。
   */
  async replace(input, write) {
    const { track, scope, text } = this.#validateEntry(input, write)
    this.#assertMatch(input)
    // 审批前先定位：零/多命中在打扰用户之前就响亮失败。
    const previous = this.#resolveMatch(input, track, scope)
    const net = text.length - previous.text.length
    this.#assertBudget(track, scope, this.store.usage(track, scope), net)
    const outcome = await askApproval(this.approval, { action: 'replace', track, scope, text }, write)
    this.#assertOutcome(outcome)
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
   * @param {object} input - {track, scope, match}。
   * @param {object} write - {agent, callId?, signal?}。
   * @returns {Promise<{entry: object, usage: object}>}。
   */
  async remove(input, write) {
    this.#assertAgent(write)
    this.#assertScope(input.track, input.scope)
    this.#assertMatch(input)
    // 审批前先定位：零/多命中在打扰用户之前就响亮失败。
    this.#resolveMatch(input, input.track, input.scope)
    const outcome = await askApproval(this.approval, { action: 'remove', track: input.track, scope: input.scope, text: input.match }, write)
    this.#assertOutcome(outcome)
    this.#throwIfAborted(write)
    const removed = this.store.removeEntry({ track: input.track, scope: input.scope, match: input.match })
    this.#auditWrite('remove', input.track, input.scope, removed, write)
    this.#appendWriteEvent(write, SESSION_EVENTS.removed, { entry: removed, source: removed.source })
    return { entry: removed, usage: this.#usage(input.track, input.scope) }
  }

  /**
   * 批量种子（一次 ask 审批整个批次；dsh-claude-move 等插件喂数据用）。
   * 任一条超预算 → 整批拒绝（先全量预检再落盘，无部分写入）。
   * @param {Array<object>} inputs - 条目数组（track/scope/text/source/workspaceKey）。
   * @param {object} write - {agent, callId?, signal?}。
   * @returns {Promise<{added: number, entries: object[]}>}。
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
    const outcome = await askApproval(this.approval, {
      action: 'seed', track: 'batch', scope: 'batch', text: summary, count: normalized.length,
    }, write)
    this.#assertOutcome(outcome)
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
  #assertAgent(write) {
    if (write === null || typeof write !== 'object' || write.agent === undefined || write.agent === null) {
      throw new NoAgentError()
    }
  }

  /** track/scope 词汇校验（响亮失败，绝不落到 SQL）。 */
  #assertScope(track, scope) {
    if (!TRACKS.includes(track) || !SCOPES.includes(scope)) {
      throw new InvalidInputError(`invalid memory scope: track=${JSON.stringify(track)} scope=${JSON.stringify(scope)} (track ∈ ${TRACKS.join('|')}, scope ∈ ${SCOPES.join('|')})`)
    }
  }

  /** match 参数校验（replace/remove 共用）。 */
  #assertMatch(input) {
    if (typeof input.match !== 'string' || input.match.length === 0) {
      throw new InvalidInputError('replace/remove match must be a non-empty string')
    }
  }

  /** 条目公共校验：agent + scope + 非空文本。 */
  #validateEntry(input, write) {
    this.#assertAgent(write)
    this.#assertScope(input.track, input.scope)
    if (typeof input.text !== 'string' || input.text.length === 0) {
      throw new InvalidInputError('entry text must be a non-empty string')
    }
    return { track: input.track, scope: input.scope, text: input.text }
  }

  /** 审批前定位替换/删除目标（唯一子串语义，零/多命中结构化报错）。 */
  #resolveMatch(input, track, scope) {
    const hits = this.store.queryEntries({ track, scope, text: input.match }).entries
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
  #assertBudget(track, scope, used, addition) {
    const checked = checkBudget(used, this.limits[track][scope], addition)
    if (!checked.ok) {
      throw new BudgetExceededError({ track, scope, used: checked.used, limit: checked.limit, needed: checked.needed })
    }
  }

  /** 审批结果门：唯一放行是 allowed-once。 */
  #assertOutcome(outcome) {
    if (outcome !== 'allowed-once') throw new WriteDeniedError(outcome)
  }

  /** @param {object} write - {signal?}。 */
  #throwIfAborted(write) {
    write.signal?.throwIfAborted()
  }

  /** 写成功的审计行（含审批来源与策略）。 */
  #auditWrite(action, track, scope, entry, write) {
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
  #appendWriteEvent(write, type, data) {
    const sessionId = write.agent.session?.id ?? ''
    maybeAppendSessionEvent(write.agent.session, type, { ...data, sessionId })
  }

  /** (track, scope) 用量与上限（工具结果回带，模型据此整合重试）。 */
  #usage(track, scope) {
    return { track, scope, used: this.store.usage(track, scope), limit: this.limits[track][scope] }
  }

  /** @param {object} write - {agent}。 */
  #workspaceKeyOf(write) {
    return workspaceKeyOf(write.agent.session?.header?.cwd)
  }
}

/** 去重的 (track, scope) 组合（seed 预检用）。 */
function uniqueScopes(entries) {
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
function toToolError(error) {
  const detail = error instanceof MemoryError ? error.details : {}
  return {
    code: error instanceof MemoryError ? error.code : 'INTERNAL',
    message: error.message,
    ...(detail.outcome === undefined ? {} : { outcome: detail.outcome }),
    ...(detail.used === undefined ? {} : { usage: { track: detail.track, scope: detail.scope, used: detail.used, limit: detail.limit } }),
    ...(detail.candidates === undefined ? {} : { candidates: detail.candidates }),
    ...(detail.sample === undefined ? {} : { sample: detail.sample }),
  }
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
    async execute(args, exec) {
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
              { sessionId: exec.agent?.session?.id },
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
    },
  })
}

/** 工具结果里的公开条目投影（只带声明过的字段）。 */
function publicEntry(entry) {
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
export function renderMemoryResult(_args, value) {
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
export function apply(ctx, config = {}) {
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
  if (!budgetCheck.ok) throw new InvalidInputError(`dsh-memento config: ${budgetCheck.message}`)
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

  ctx.tools.register(makeMemoryTool(service))

  // 冻结快照注入：会话首个 assemble 时同步读库渲染，WeakMap 按 Session 冻结。
  // 提供者必须同步（rc.6 不 await systemPrompt 提供者），SQLite 同步读满足。
  // 渲染文本同时进入 request/header（system 字段）→ 可自会话日志重建（S2）。
  const snapshots = new WeakMap()
  ctx.systemPrompt.section({
    name: 'dsh-memento:memory',
    order: resolved.snapshotOrder,
    text: (assemble) => {
      const agent = assemble?.agent
      const session = agent?.session
      if (session === undefined || session === null) return ''
      let frozen = snapshots.get(session)
      if (frozen === undefined) {
        const workspaceKey = workspaceKeyOf(session.header?.cwd)
        const entries = visibleEntries(store.listEntries(), workspaceKey)
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
          sessionId: session.id ?? null,
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
}

export { MemoryError, InvalidInputError, BudgetExceededError, EntryNotFoundError, AmbiguousMatchError, WriteDeniedError, NoAgentError }
export { buildWriteReason, isMemoryWriteRequest, applyWritePolicy, normalizeWritePolicy }
export { openMemoryStore, resolveDbPath }
export { renderSnapshot, visibleEntries }
export { workspaceKeyOf }
export { validateBudgets, budgetReport, budgetLimits, checkBudget }
export { errorToPublic }
