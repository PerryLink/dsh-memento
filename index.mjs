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
import { readFileSync } from 'node:fs'
import {
  TOOL_NAME,
  DEFAULT_SOURCE,
  SESSION_EVENTS,
  PANEL_AUDIT_CEILING,
  EXPORT_SCHEMA,
  MAX_IMPORT_ENTRIES,
} from './lib/constants.mjs'
import {
  MemoryError,
  InvalidInputError,
  BudgetExceededError,
  EntryNotFoundError,
  AmbiguousMatchError,
  WriteDeniedError,
  NoAgentError,
  ProposalNotFoundError,
  AdapterNotFoundError,
  AdapterPayloadError,
} from './lib/errors.mjs'
import { validateBudgets, budgetReport, budgetLimits, checkBudget } from './lib/budget.mjs'
import { buildWriteReason, isMemoryWriteRequest, applyWritePolicy, normalizeWritePolicy, resolveWritePolicy, validateWritePolicies, parseWriteReason } from './lib/gate.mjs'
import { MemoryProtocolCore, PROTOCOL_ID, PROTOCOL_VERSION, PROTOCOL_URI, normalizeTags, validateMemoryEntry, validateExportEnvelope, validateAuditRow, MAX_TAGS_PER_ENTRY, MAX_TAG_LENGTH } from './lib/protocol.mjs'
import { MemoryAdapterRegistry } from './lib/registry.mjs'
import { REFERENCE_ADAPTERS } from './lib/adapters.mjs'
import { renderSnapshot, visibleEntries, visibleProposals } from './lib/snapshot.mjs'
import { openMemoryStore, resolveDbPath } from './lib/store.mjs'
import { workspaceKeyOf, agentKeyOf } from './lib/workspace.mjs'
import { extractEventText } from './lib/extract.mjs'
import { EmbeddingProviderRegistry, FakeEmbeddingProvider } from './lib/embedding.mjs'
import { RetrievalProviderRegistry, SubstringRetriever, VectorRetriever, detectVectorBackend } from './lib/retrieval.mjs'

/**
 * @typedef {import('./types.js').MemoryEntry} MemoryEntry
 * @typedef {import('./types.js').MemoryQueryResult} MemoryQueryResult
 * @typedef {import('./types.js').MemoryWriteContext} MemoryWriteContext
 * @typedef {import('./types.js').MemorySessionLike} MemorySessionLike
 * @typedef {{track: string, scope: string, used: number, limit: number}} MemoryUsage
 * @typedef {{id: string, kind: string, track: string, scope: string, workspaceKey: string, agentKey: string, text: string, source: string, sessionId: string | null, status: string, createdAt: number, decidedAt: number | null}} MemoryProposal
 * @typedef {{user: {userGlobal: number, workspace: number}, agent: {userGlobal: number, workspace: number}}} BudgetsConfig
 * @typedef {object} StoreHandle - ctx.memory 依赖的 Provider 面。
 * @property {(filter?: {track?: string, scope?: string, text?: string, limit?: number}) => MemoryQueryResult} queryEntries
 * @property {() => MemoryEntry[]} listEntries
 * @property {(ids: string[]) => void} bumpRecall
 * @property {(track: string, scope: string, match: string, opts?: {agentKey?: string, workspaceKey?: string}) => MemoryEntry[]} matchCandidates
 * @property {(track: string, scope: string) => number} usage
 * @property {(input: object) => MemoryEntry} insertEntry
 * @property {(inputs: object[]) => MemoryEntry[]} seedEntries
 * @property {(input: object) => {previous: MemoryEntry, entry: MemoryEntry}} replaceEntry
 * @property {(input: object) => MemoryEntry} removeEntry
 * @property {(input: object) => {removed: MemoryEntry[], entry: MemoryEntry}} consolidateEntries
 * @property {(row: object) => object} auditAppend
 * @property {(limit?: number) => object[]} auditList
 * @property {(input: object) => object | null} proposalUpsert
 * @property {(status?: string, limit?: number) => object[]} proposalList
 * @property {(id: string, status: string) => object} proposalDecide
 * @property {() => void} close
 * @typedef {{request: (req: object) => Promise<string>, overrideOf?: (session: unknown) => string | undefined, config?: {policy?: string}}} ApprovalLike
 * @typedef {object} ServiceDeps
 * @property {StoreHandle} store
 * @property {BudgetsConfig} budgets
 * @property {string} writePolicy
 * @property {number} maxEntriesPerQuery
 * @property {number} commandListLimit
 * @property {number} commandAuditLimit
 * @property {'en'|'zh'} language
 * @property {ApprovalLike} approval
 * @property {string} [sourceLabel]
 * @typedef {object} PluginConfig - apply 的宽松配置形状（cordis loader 已套 schema 默认值）。
 * @property {boolean} [enabled]
 * @property {string} [dbPath]
 * @property {{user?: {userGlobal?: number, workspace?: number}, agent?: {userGlobal?: number, workspace?: number}}} [budgets]
 * @property {string} [writePolicy]
 * @property {Record<string, string>} [writePolicies]
 * @property {'en'|'zh'} [language]
 * @property {number} [snapshotOrder]
 * @property {number} [maxEntriesPerQuery]
 * @property {number} [commandListLimit]
 * @property {number} [commandAuditLimit]
 * @property {{historyLimitDefault?: number, snippetCap?: number, snippetChars?: number, windowDays?: number}} [recall]
 * @property {{vector?: boolean}} [retrieval]
 * @property {number} [panelEntriesLimit]
 * @property {number} [panelAuditLimit]
 * @property {number} [auditRetentionDays]
 * @property {{enabled?: boolean, maxChars?: number, maxPending?: number}} [proposals]
 * @typedef {{action: string, track: string, scope: string, text: string, count?: number, source?: string}} WritePayload
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
 * @property {Array<{id: string, text: string}>} [removed]
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
 * @property {Record<string, 'ask'|'auto'|'off'>} [writePolicies] 粒度写策略（键 `track/scope` 或 `source:<name>`；未命中回退 writePolicy）。
 * @property {'en'|'zh'} [language] 模型可见文案与命令输出语言（默认 en；快照/工具描述/命令随选）。
 * @property {number} [snapshotOrder] 快照段注入顺序（默认 -50，靠前负值）。
 * @property {number} [maxEntriesPerQuery] query 默认返回条目上限（显式 limit 可超出，Provider 硬钳 1000）。
 * @property {number} [commandListLimit] /memory list|query 单次渲染条目上限（默认 50）。
 * @property {number} [commandAuditLimit] /memory audit 单次渲染审计行上限（默认 10）。
 * @property {{historyLimitDefault?: number, snippetCap?: number, snippetChars?: number, windowDays?: number}} [recall]
 *   memory_recall 历史段默认值（默认 8/5/300/30）。
 * @property {{vector?: boolean}} [retrieval] 语义召回开关（默认 false：substring 主路径；
 *   true 且探测到 embedding provider 时 memory_recall 走向量召回，否则优雅降级回 substring）。
 * @property {number} [panelEntriesLimit] 面板条目页上限与钳制（默认 200）。
 * @property {number} [panelAuditLimit] 面板审计默认条数（默认 20；上限 200 为协议常量）。
 * @property {number} [auditRetentionDays] 审计保留天数（默认 0 = 不限）。
 * @property {{enabled?: boolean, maxChars?: number, maxPending?: number}} [proposals]
 *   auto-capture 压缩记忆提案（默认 true / 2000 / 8）。
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
  writePolicies: Schema.dict(Schema.union(['ask', 'auto', 'off'])).default({}),
  language: Schema.union(['en', 'zh']).default('en'),
  snapshotOrder: Schema.number().default(DEFAULT_SNAPSHOT_ORDER),
  maxEntriesPerQuery: Schema.number().default(20),
  commandListLimit: Schema.number().default(50),
  commandAuditLimit: Schema.number().default(10),
  recall: Schema.object({
    historyLimitDefault: Schema.number().default(8),
    snippetCap: Schema.number().default(5),
    snippetChars: Schema.number().default(300),
    windowDays: Schema.number().default(30),
  }),
  retrieval: Schema.object({
    vector: Schema.boolean().default(false),
  }),
  panelEntriesLimit: Schema.number().default(200),
  panelAuditLimit: Schema.number().default(20),
  auditRetentionDays: Schema.number().default(0),
  proposals: Schema.object({
    enabled: Schema.boolean().default(true),
    maxChars: Schema.number().default(2000),
    maxPending: Schema.number().default(8),
  }),
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
 * rc.2 复核（2026-08-22）：KNOWN_SESSION_EVENT_TYPES 仍不含 memory/*，
 * Session.append 写入面仍只接受 surface intent 可选参（非 surface 类型
 * 保持两参调用形态）、仍无 writer 侧 ignorable 标记；读取端已有 ignorable
 * 信封容忍未知类型。故本门在 rc.2 下保持关闭，行为不变。
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
 * 协议写语义（预算预检 → 审批 → 预算复审 → 落盘 → 审计）在 lib/protocol.mjs 的
 * MemoryProtocolCore 里——协议与实现分离，协议部分零 DSH 依赖；本类只注入两件
 * DSH 专属物：审批传输（ctx.approval）与会话事件派发（memory/* 词汇的已知类型
 * 自适应门）。读方法无审批；禁用时本服务整体不存在。
 */
export class MemoryService extends MemoryProtocolCore {
  /**
   * @param {ServiceDeps} deps - {store, budgets, writePolicy, maxEntriesPerQuery, commandListLimit, commandAuditLimit, language, approval, sourceLabel}。
   */
  constructor(deps) {
    super({
      store: deps.store,
      budgets: deps.budgets,
      writePolicy: deps.writePolicy,
      defaultQueryLimit: deps.maxEntriesPerQuery,
      sourceLabel: deps.sourceLabel,
      gate: (payload, write) => askApproval(deps.approval, /** @type {WritePayload} */ (payload), write),
      emit: (session, type, data) => maybeAppendSessionEvent(session, type, data),
    })
    this.commandListLimit = deps.commandListLimit
    this.commandAuditLimit = deps.commandAuditLimit
    this.language = deps.language
  }
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

/** 记忆工具描述：内嵌 Save/Skip 行为指引（学 Hermes 官方 memory.md 清单）。en 为源文，zh 为对应译文。 */
const MEMORY_TOOL_DESCRIPTION = {
  en: [
    'Read and write the bounded, layered, approval-gated cross-session memory store (dsh-memento).',
    '',
    'Tracks: "user" holds facts about the user (preferences, communication style, landmines, corrections); "agent" holds environment facts, project conventions, lessons learned, and completed-work summaries. Layers: "user-global" applies to every workspace; "workspace" applies only to the current working directory.',
    '',
    'Each track/layer pair has a hard character budget (shown in the session memory snapshot header). A write that would exceed it FAILS with a structured error carrying current usage and the limit — consolidate or remove entries, then retry. Never truncate or silently drop content.',
    '',
    'SAVE: user preferences and corrections; environment facts and project conventions; lessons learned from mistakes; summaries of completed work; anything the user explicitly asks you to remember.',
    'SKIP: trivial or re-derivable facts; encyclopedia knowledge a fresh search can answer; large data dumps or logs; one-off file paths; content already available in the current workspace.',
    '',
    'Writes (add/replace/remove/consolidate) require approval under the configured policy and are audited; reads (query) are free. replace/remove target an entry by a UNIQUE case-insensitive substring — an ambiguous match fails with the candidate list, so use a longer substring. consolidate merges 1..20 existing entries (unique substrings) into ONE new entry with a single approval and one atomic write — use it when a layer is over budget. Each session receives a frozen snapshot of current memory at startup; the snapshot never changes mid-session.',
  ].join('\n'),
  zh: [
    '读写有界、分层、带审批门、可审计的跨会话记忆库（dsh-memento）。',
    '',
    '轨道："user" 存用户相关事实（偏好、沟通风格、雷区、纠正）；"agent" 存环境事实、项目约定、教训与已完成工作总结。层："user-global" 对所有工作区生效；"workspace" 只对当前工作目录生效。',
    '',
    '每对轨道/层有硬字符预算（显示在会话记忆快照头部）。会超限的写入以结构化错误失败（携带当前用量与上限）——整合或删除条目后重试。绝不截断、绝不静默丢弃内容。',
    '',
    '应存（SAVE）：用户偏好与纠正；环境事实与项目约定；犯错得到的教训；已完成工作总结；用户明确要求记住的内容。',
    '应跳过（SKIP）：琐碎或可再推导的事实；重新搜索即可回答的百科知识；大数据转储或日志；一次性文件路径；当前工作区已有的内容。',
    '',
    '写（add/replace/remove/consolidate）需按配置策略审批并落审计；读（query）免费。replace/remove 用唯一大小写不敏感子串定位——歧义时报候选清单，请用更长子串。consolidate 以一次审批 + 一次原子写把 1..20 条整合为一条——层超预算时使用。每个会话启动时获得当前记忆的冻结快照；会话内快照不变。',
  ].join('\n'),
}

/** 记忆工具参数描述（双语）。 */
const MEMORY_TOOL_PARAMETERS = {
  en: {
    action: 'add = insert a new entry; replace = rewrite one existing entry; remove = delete one existing entry; consolidate = merge 1..20 existing entries into one new entry (single approval, atomic); query = substring search over existing entries.',
    track: 'Memory track. Defaults to "user". user = facts about the user; agent = environment/project facts and conventions.',
    scope: 'Layer. Defaults to "workspace". user-global applies to every workspace; workspace applies only to this working directory.',
    text: 'add/replace: the exact entry text. query: case-insensitive substring filter.',
    match: 'replace/remove: a UNIQUE case-insensitive substring of the existing entry to target.',
    matches: 'consolidate: 1..20 UNIQUE case-insensitive substrings of the entries to merge into the new text.',
    limit: 'query: maximum entries to return (default 20; hard-capped at 1000).',
    tags: 'Optional short labels for the entry (e.g. ["project-x", "decision"]). At most 16 tags, each at most 32 characters; applies to add/replace/consolidate.',
  },
  zh: {
    action: 'add = 新增一条；replace = 改写一条既有条目；remove = 删除一条既有条目；consolidate = 把 1..20 条既有条目整合为一条新条目（单次审批、原子执行）；query = 对既有条目的子串检索。',
    track: '记忆轨道。默认 "user"。user = 用户相关事实；agent = 环境/项目事实与约定。',
    scope: '层。默认 "workspace"。user-global 对所有工作区生效；workspace 只对当前工作目录生效。',
    text: 'add/replace：完整条目文本。query：大小写不敏感子串过滤。',
    match: 'replace/remove：目标条目的唯一大小写不敏感子串。',
    matches: 'consolidate：要并入新文本的 1..20 个唯一大小写不敏感子串。',
    limit: 'query：最多返回条数（默认 20；硬钳 1000）。',
    tags: '可选短标签（如 ["project-x", "decision"]）。最多 16 个、每个最多 32 字符；用于 add/replace/consolidate。',
  },
}

/**
 * memory 工具定义（Consumer）。execute 尊重 exec.signal；领域失败返回
 * ok:false + 结构化 error，基础设施失败才抛出（isError）。
 * @param {MemoryService} service - ctx.memory。
 * @param {'en'|'zh'} [language] - 'en' | 'zh'。
 * @returns {object} 工具定义。
 */
export function makeMemoryTool(service, language = 'en') {
  const parameters = MEMORY_TOOL_PARAMETERS[language] ?? MEMORY_TOOL_PARAMETERS.en
  return defineTool({
    name: 'memory',
    description: MEMORY_TOOL_DESCRIPTION[language] ?? MEMORY_TOOL_DESCRIPTION.en,
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['add', 'replace', 'remove', 'consolidate', 'query'],
        description: parameters.action,
      },
      track: {
        type: 'string',
        enum: ['user', 'agent'],
        description: parameters.track,
      },
      scope: {
        type: 'string',
        enum: ['user-global', 'workspace'],
        description: parameters.scope,
      },
      text: {
        type: 'string',
        description: parameters.text,
      },
      match: {
        type: 'string',
        description: parameters.match,
      },
      matches: {
        type: 'array',
        items: { type: 'string' },
        description: parameters.matches,
      },
      limit: {
        type: 'integer',
        description: parameters.limit,
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: parameters.tags,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true, enum: ['add', 'replace', 'remove', 'consolidate', 'query'] },
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
              tags: { type: 'array', items: { type: 'string' }, required: true },
            },
          },
          removed: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                text: { type: 'string', required: true },
              },
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
                tags: { type: 'array', items: { type: 'string' }, required: true },
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
              {
                sessionId: exec.agent?.session?.id,
                session: exec.agent?.session,
                // 会话内读按可见集过滤（共享 + 本 agent），与冻结快照同一语义。
                agentKey: agentKeyOf(/** @type {string | undefined} */ (exec.agent?.session?.header?.agentPreset)),
              },
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
                ...(args.tags === undefined ? {} : { tags: args.tags }),
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
                ...(args.tags === undefined ? {} : { tags: args.tags }),
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
          case 'consolidate': {
            const result = await service.consolidate(
              {
                track: args.track ?? 'user',
                scope: args.scope ?? 'workspace',
                matches: args.matches,
                text: args.text,
                source: 'memory-tool',
                ...(args.tags === undefined ? {} : { tags: args.tags }),
              },
              write,
            )
            return {
              action: 'consolidate',
              ok: true,
              entry: publicEntry(result.entry),
              removed: result.removed.map((old) => ({ id: old.id, text: old.text })),
              usage: result.usage,
            }
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
    tags: entry.tags,
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
    case 'consolidate':
      return [{ type: 'text', text: `memory entries consolidated (${value.entry.track}/${value.entry.scope}): ${value.removed.length} removed → ${value.entry.text}\nbudget: ${value.usage.used}/${value.usage.limit} chars used` }]
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
    writePolicies: config.writePolicies ?? {},
    language: config.language ?? 'en',
    snapshotOrder: config.snapshotOrder ?? DEFAULT_SNAPSHOT_ORDER,
    maxEntriesPerQuery: config.maxEntriesPerQuery ?? 20,
    commandListLimit: config.commandListLimit ?? 50,
    commandAuditLimit: config.commandAuditLimit ?? 10,
    recall: {
      historyLimitDefault: config.recall?.historyLimitDefault ?? 8,
      snippetCap: config.recall?.snippetCap ?? 5,
      snippetChars: config.recall?.snippetChars ?? 300,
      windowDays: config.recall?.windowDays ?? 30,
    },
    retrieval: {
      vector: config.retrieval?.vector ?? false,
    },
    panelEntriesLimit: config.panelEntriesLimit ?? 200,
    panelAuditLimit: config.panelAuditLimit ?? 20,
    auditRetentionDays: config.auditRetentionDays ?? 0,
    proposals: {
      enabled: config.proposals?.enabled ?? true,
      maxChars: config.proposals?.maxChars ?? 2000,
      maxPending: config.proposals?.maxPending ?? 8,
    },
  }
  if (resolved.enabled === false) return
  const budgetCheck = validateBudgets(resolved.budgets)
  if (!budgetCheck.ok) throw new InvalidInputError(`dsh-memento config: ${/** @type {{message: string}} */ (budgetCheck).message}`)
  normalizeWritePolicy(resolved.writePolicy)
  validateWritePolicies(resolved.writePolicies)
  if (resolved.language !== 'en' && resolved.language !== 'zh') {
    throw new InvalidInputError(`dsh-memento config: language must be 'en' or 'zh' (got ${JSON.stringify(resolved.language)})`)
  }
  if (!Number.isFinite(resolved.snapshotOrder)) {
    throw new InvalidInputError('dsh-memento config: snapshotOrder must be a finite number')
  }
  if (!Number.isInteger(resolved.maxEntriesPerQuery) || resolved.maxEntriesPerQuery <= 0) {
    throw new InvalidInputError('dsh-memento config: maxEntriesPerQuery must be a positive integer')
  }
  if (!Number.isInteger(resolved.commandListLimit) || resolved.commandListLimit <= 0) {
    throw new InvalidInputError('dsh-memento config: commandListLimit must be a positive integer')
  }
  if (!Number.isInteger(resolved.commandAuditLimit) || resolved.commandAuditLimit <= 0) {
    throw new InvalidInputError('dsh-memento config: commandAuditLimit must be a positive integer')
  }
  for (const [key, value] of Object.entries(resolved.recall)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new InvalidInputError(`dsh-memento config: recall.${key} must be a positive integer`)
    }
  }
  if (!Number.isInteger(resolved.panelEntriesLimit) || resolved.panelEntriesLimit <= 0) {
    throw new InvalidInputError('dsh-memento config: panelEntriesLimit must be a positive integer')
  }
  if (!Number.isInteger(resolved.panelAuditLimit) || resolved.panelAuditLimit <= 0) {
    throw new InvalidInputError('dsh-memento config: panelAuditLimit must be a positive integer')
  }
  if (!Number.isInteger(resolved.auditRetentionDays) || resolved.auditRetentionDays < 0) {
    throw new InvalidInputError('dsh-memento config: auditRetentionDays must be a non-negative integer')
  }
  if (!Number.isInteger(resolved.proposals.maxChars) || resolved.proposals.maxChars <= 0) {
    throw new InvalidInputError('dsh-memento config: proposals.maxChars must be a positive integer')
  }
  if (!Number.isInteger(resolved.proposals.maxPending) || resolved.proposals.maxPending <= 0) {
    throw new InvalidInputError('dsh-memento config: proposals.maxPending must be a positive integer')
  }
  const dbPath = resolveDbPath(resolved.dbPath)
  const store = openMemoryStore(dbPath, { retentionDays: resolved.auditRetentionDays })
  const service = new MemoryService({
    store,
    budgets: resolved.budgets,
    writePolicy: resolved.writePolicy,
    maxEntriesPerQuery: resolved.maxEntriesPerQuery,
    commandListLimit: resolved.commandListLimit,
    commandAuditLimit: resolved.commandAuditLimit,
    language: resolved.language,
    approval: ctx.approval,
    sourceLabel: DEFAULT_SOURCE,
  })

  ctx.provide('memory', service)
  ctx.effect(() => () => store.close(), 'dsh-memento.store.close')

  // 协议 v1 适配器注册表（ctx.memoryAdapters）：第三方记忆插件可 register() 自己的
  // 适配器把外部 store 接进协议。注册可逆（register 返回 disposer，经 ctx.effect 随
  // 插件生命周期自动回收）；内置参考适配器（mem0 / Hermes / CLAUDE.md）同生命周期。
  const adapters = new MemoryAdapterRegistry()
  ctx.provide('memoryAdapters', adapters)
  for (const adapter of REFERENCE_ADAPTERS) {
    ctx.effect(() => adapters.register(adapter), `dsh-memento.adapter.${adapter.id}`)
  }

  // embedding Provider seam（ctx.memoryEmbedding）：注册表 + 默认确定性伪嵌入
  // Provider（零依赖，接口级演示；真实嵌入由可选 provider 注册）。register 可逆，
  // 经 ctx.effect 随插件生命周期自动回收。
  const embeddings = new EmbeddingProviderRegistry()
  ctx.provide('memoryEmbedding', embeddings)
  ctx.effect(() => embeddings.register(new FakeEmbeddingProvider()), 'dsh-memento.embedding.fake-hash')

  // retrieval Provider seam（ctx.memoryRetrieval）：内置 substring 检索器（零依赖
  // 主路径）+ 可选 vector 检索器。vector 仅当 Config.retrieval.vector=true 且探测到
  // embedding provider 时启用；否则优雅降级回 substring（retriever 保持 null）。
  const retrievers = new RetrievalProviderRegistry()
  ctx.provide('memoryRetrieval', retrievers)
  ctx.effect(() => retrievers.register(new SubstringRetriever()), 'dsh-memento.retrieval.substring')
  const resolvedRetriever = resolved.retrieval.vector === true ? setupVectorRetriever(ctx, retrievers, embeddings) : null

  // 审批 answerer：认领本插件的记忆写请求并按粒度策略裁决（writePolicies 精确键 >
  // track/scope > 全局 writePolicy；prepend 保证 auto/off 的确定性先于 UI answerer；
  // 会话级 never 策略在审批服务内部先裁决，任何 answerer 都无法绕过）。
  ctx.on('approval/request', async function answerer(req, next) {
    if (!isMemoryWriteRequest(req)) return next()
    const parsed = parseWriteReason(/** @type {string} */ (/** @type {{reason: string}} */ (req).reason))
    const effective = parsed === null
      ? resolved.writePolicy
      : resolveWritePolicy(resolved.writePolicies, resolved.writePolicy, parsed.track, parsed.scope, parsed.source)
    return applyWritePolicy(effective, req, next)
  }, { prepend: true })

  ctx.tools.register(/** @type {import('@deepseek-ai/dsh-tools').ToolDefinition} */ (makeMemoryTool(service, resolved.language)))

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
        const agentKey = agentKeyOf(/** @type {string | undefined} */ (session.header?.agentPreset))
        const entries = visibleEntries(
          /** @type {Array<{id: string, track: string, scope: string, workspaceKey: string, agentKey: string, text: string, createdAt: number}>} */ (store.listEntries()),
          workspaceKey,
          agentKey,
        )
        const proposals = visibleProposals(
          /** @type {MemoryProposal[]} */ (store.proposalList('pending', resolved.proposals.maxPending)),
          workspaceKey,
          agentKey,
        )
        frozen = renderSnapshot(entries, resolved.budgets, proposals, resolved.language)
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
  ctx.tools.register(/** @type {import('@deepseek-ai/dsh-tools').ToolDefinition} */ (makeMemoryRecallTool(service, ctx, resolved.recall, resolved.language, resolvedRetriever)))
  registerWebRoutes(ctx, service, resolved)

  // auto-capture：监听会话事件火线，压缩结束后生成记忆提案（只落提案，不写记忆、不调模型）。
  const summaries = new WeakMap()
  ctx.on('session/event', (session, event) => {
    handleSessionEvent(store, session, event, resolved.proposals, summaries)
  })
}

/**
 * 按 Config.retrieval.vector 探测并装配 vector 检索器：探测到 embedding provider
 * 才注册 VectorRetriever 并返回之；否则优雅降级（返回 null，调用方回退 substring
 * 主路径），绝不响亮失败——vector 是可选后端，缺 embedding 不构成配置错误。
 * @param {import('@deepseek-ai/cordis').Context} ctx - Cordis 上下文（注册 effect）。
 * @param {import('./lib/retrieval.mjs').RetrievalProviderRegistry} retrievers - 检索注册表。
 * @param {import('./lib/embedding.mjs').EmbeddingProviderRegistry} embeddings - 嵌入注册表。
 * @returns {import('./lib/retrieval.mjs').RetrievalProvider | null} vector 检索器或 null（降级）。
 */
function setupVectorRetriever(ctx, retrievers, embeddings) {
  const embedding = embeddings.get('fake-hash')
  const probe = detectVectorBackend({ embedding })
  if (!probe.available) return null
  const retriever = new VectorRetriever({ embedding })
  ctx.effect(() => retrievers.register(retriever), 'dsh-memento.retrieval.vector')
  return retriever
}

/**
 * auto-capture 提案生成：缓存每会话最近的 compaction/summary 文本，compaction/end
 * 成功时截断落 proposals 表（(session_id, kind) 幂等；pending 满则弃新）。
 * 本函数不调用任何模型、不写任何记忆条目、不触碰审批 seam——提案是待审批数据。
 * @param {StoreHandle} store - Provider。
 * @param {MemorySessionLike | null | undefined} session - 会话。
 * @param {unknown} event - 会话事件（{type, data}）。
 * @param {{enabled: boolean, maxChars: number, maxPending: number}} proposals - Config.proposals。
 * @param {WeakMap<object, string>} summaries - 会话 → 最近 summary 文本缓存。
 */
function handleSessionEvent(store, session, event, proposals, summaries) {
  if (!proposals.enabled || session === null || session === undefined) return
  if (event === null || typeof event !== 'object') return
  const record = /** @type {{type?: unknown, data?: unknown}} */ (event)
  if (record.type === 'compaction/summary') {
    const text = extractEventText(event)
    if (text.length > 0) summaries.set(session, text)
    return
  }
  if (record.type !== 'compaction/end') return
  const data = record.data
  const error = data !== null && typeof data === 'object' ? /** @type {{error?: unknown}} */ (data).error : undefined
  if (typeof error === 'string' && error.length > 0) return
  const text = summaries.get(session)
  summaries.delete(session)
  if (typeof text !== 'string' || text.length === 0) return
  const pending = /** @type {MemoryProposal[]} */ (store.proposalList('pending', proposals.maxPending))
  if (pending.length >= proposals.maxPending) return // 满则弃新
  const truncated = text.length > proposals.maxChars ? text.slice(0, proposals.maxChars) : text
  const proposal = store.proposalUpsert({
    kind: 'compaction-summary',
    track: 'agent',
    scope: 'workspace',
    workspaceKey: workspaceKeyOf(/** @type {string | undefined} */ (session.header?.cwd)),
    agentKey: agentKeyOf(/** @type {string | undefined} */ (session.header?.agentPreset)),
    text: truncated,
    source: 'compaction',
    sessionId: typeof session.id === 'string' ? session.id : '',
  })
  if (proposal === null) return // 同 session 已提案（幂等）
  const created = /** @type {MemoryProposal} */ (proposal)
  store.auditAppend({
    action: 'proposal',
    track: 'agent',
    scope: 'workspace',
    entryId: created.id,
    text: truncated,
    outcome: 'pending',
    source: 'compaction',
    sessionId: typeof session.id === 'string' ? session.id : null,
  })
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
 * /memory 命令文案（en 源文 / zh 译文；service.language 选择）。
 * @typedef {object} CommandTextBundle
 * @property {string} usage
 * @property {string} memoryEmpty
 * @property {(total: number, shown: number) => string} entries
 * @property {(total: number) => string} entriesFull
 * @property {string} queryNeedsWord
 * @property {(text: string) => string} noMatch
 * @property {(total: number, shown: number) => string} matches
 * @property {(total: number) => string} matchesFull
 * @property {string} budgets
 * @property {string} proposalsNone
 * @property {(n: number, rows: string) => string} proposalsList
 * @property {string} proposalsUsage
 * @property {(id: string) => string} proposalNotPending
 * @property {(track: string, scope: string, text: string, used: number, limit: number) => string} proposalApproved
 * @property {(id: string) => string} proposalDismissed
 * @property {string} auditEmpty
 * @property {(n: number) => string} audit
 * @property {string} addNeedsText
 * @property {(track: string, scope: string, text: string, used: number, limit: number) => string} added
 * @property {string} removeNeedsSubstring
 * @property {(track: string, scope: string, text: string, used: number, limit: number) => string} removed
 * @property {string} consolidateUsage
 * @property {string} consolidateNeedsMatches
 * @property {string} consolidateNeedsText
 * @property {(track: string, scope: string, removed: number, text: string, used: number, limit: number) => string} consolidated
 * @property {string} exportUsage
 * @property {string} importUsage
 * @property {string} importBadJson
 * @property {(path: string, message: string) => string} importReadFailed
 * @property {(schema: string) => string} importBadSchema
 * @property {string} importNoEntries
 * @property {(max: number) => string} importTooMany
 * @property {string} importBadEntry
 * @property {(n: number) => string} imported
 * @property {string} adaptersEmpty
 * @property {(n: number, rows: string) => string} adaptersList
 * @property {string} adapterExportUsage
 * @property {string} adapterImportUsage
 * @property {string} adapterServiceMissing
 * @property {string} adapterBadFlag
 * @property {(id: string) => string} adapterUnknown
 * @property {(id: string, message: string) => string} adapterPayload
 * @property {(n: number, id: string) => string} adapterImported
 * @property {(verb: string) => string} unknownVerb
 * @property {(message: string) => string} commandFailed
 */
const COMMAND_TEXT = /** @type {{en: CommandTextBundle, zh: CommandTextBundle}} */ ({
  en: {
    usage: 'Usage: /memory list | query <word> | add <text> | remove <substring> | consolidate <substring...> => <new text> | proposals [approve|dismiss <id>] | budgets | audit | adapters | export [--adapter=<id>] | import [--adapter=<id>] <path>',
    memoryEmpty: 'Memory is empty.',
    entries: (total, shown) => `Memory entries (${total} total, showing first ${shown}):`,
    entriesFull: (total) => `Memory entries (${total}):`,
    queryNeedsWord: 'query needs a keyword: /memory query <word>',
    noMatch: (text) => `No entry contains "${text}".`,
    matches: (total, shown) => `Matches (${total} total, showing first ${shown}):`,
    matchesFull: (total) => `Matches (${total}):`,
    budgets: 'Budget usage:',
    proposalsNone: 'No pending memory proposals.',
    proposalsList: (n, rows) => `Pending proposals (${n}):\n${rows}\nApprove: /memory proposals approve <id>; dismiss: /memory proposals dismiss <id>`,
    proposalsUsage: 'proposals usage: /memory proposals | proposals approve <id> | proposals dismiss <id>',
    proposalNotPending: (id) => `proposal ${JSON.stringify(id)} is not a pending proposal (decided or missing)`,
    proposalApproved: (track, scope, text, used, limit) => `Proposal approved and written to memory (${track}/${scope}): ${text}\nLayer usage: ${used}/${limit}`,
    proposalDismissed: (id) => `Proposal ${id} dismissed.`,
    auditEmpty: 'Audit is empty.',
    audit: (n) => `Recent audit (${n} rows):`,
    addNeedsText: 'add needs text: /memory add [--track=user|agent] [--scope=user-global|workspace] <text>',
    added: (track, scope, text, used, limit) => `Added (${track}/${scope}): ${text}\nLayer usage: ${used}/${limit}`,
    removeNeedsSubstring: 'remove needs a unique substring: /memory remove [--track=user|agent] [--scope=user-global|workspace] <substring>',
    removed: (track, scope, text, used, limit) => `Removed (${track}/${scope}): ${text}\nLayer usage: ${used}/${limit}`,
    consolidateUsage: 'consolidate usage: /memory consolidate [--track=user|agent] [--scope=user-global|workspace] <substring1> [<substring2> ...] => <new text>',
    consolidateNeedsMatches: 'consolidate needs 1..20 unique substrings (left of =>)',
    consolidateNeedsText: 'consolidate needs new text (right of =>)',
    consolidated: (track, scope, removed, text, used, limit) => `Consolidated (${track}/${scope}): removed ${removed}, added 1.\nNew entry: ${text}\nLayer usage: ${used}/${limit}`,
    exportUsage: 'export dumps all entries + budgets as one JSON document (read-only; redirect it to a file for backup/migration): /memory export',
    importUsage: 'import restores entries from an export document (a file path, or inline JSON starting with {): /memory import <path> | /memory import \'{"plugin":"dsh-memento",...}\'',
    importBadJson: 'import: inline JSON could not be parsed',
    importReadFailed: (path, message) => `import: cannot read ${JSON.stringify(path)}: ${message}`,
    importBadSchema: (schema) => `import: not a dsh-memento export document (expected schema "${schema}")`,
    importNoEntries: 'import: the export document contains no entries',
    importTooMany: (max) => `import: the export document has more than ${max} entries; split it and import in batches`,
    importBadEntry: 'import: every entry needs a string track, scope, and non-empty text',
    imported: (n) => `Imported ${n} entries into memory (single approval; budgets re-checked). Entries get fresh ids and timestamps; proposals, audit rows and recall counts are not migrated.`,
    adaptersEmpty: 'No memory adapters registered.',
    adaptersList: (n, rows) => `Memory adapters (${n}):\n${rows}\nImport: /memory import --adapter=<id> <path|inline JSON>; export: /memory export --adapter=<id>`,
    adapterExportUsage: 'adapter export usage: /memory export --adapter=<id> (read-only conversion to stdout)',
    adapterImportUsage: 'adapter import usage: /memory import --adapter=<id> <file path> (or inline JSON starting with {)',
    adapterServiceMissing: 'memory adapter registry is unavailable in this profile',
    adapterBadFlag: 'adapter id missing or invalid: use --adapter=<id> (lowercase kebab-case)',
    adapterUnknown: (id) => `no memory adapter "${id}" is registered; run /memory adapters`,
    adapterPayload: (id, message) => `adapter ${id} rejected the payload: ${message}`,
    adapterImported: (n, id) => `Imported ${n} entries via adapter ${id} (single approval; budgets re-checked). Entries get fresh ids and timestamps.`,
    unknownVerb: (verb) => `Unknown subcommand "${verb}". Usage: /memory list | query <word> | add <text> | remove <substring> | consolidate <substring...> => <new text> | proposals [approve|dismiss <id>] | budgets | audit | adapters | export [--adapter=<id>] | import [--adapter=<id>] <path>`,
    commandFailed: (message) => `memory command failed: ${message}`,
  },
  zh: {
    usage: '用法：/memory list | query <词> | add <文本> | remove <唯一子串> | consolidate <唯一子串...> => <新文本> | proposals [approve|dismiss <id>] | budgets | audit | adapters | export [--adapter=<id>] | import [--adapter=<id>] <路径>',
    memoryEmpty: '记忆为空。',
    entries: (total, shown) => `记忆条目（共 ${total} 条，显示前 ${shown} 条）：`,
    entriesFull: (total) => `记忆条目（${total} 条）：`,
    queryNeedsWord: 'query 需要一个关键词：/memory query <词>',
    noMatch: (text) => `没有条目包含「${text}」。`,
    matches: (total, shown) => `命中（共 ${total} 条，显示前 ${shown} 条）：`,
    matchesFull: (total) => `命中（${total} 条）：`,
    budgets: '预算用量：',
    proposalsNone: '暂无待审批记忆提案。',
    proposalsList: (n, rows) => `待审批提案（${n} 条）：\n${rows}\n审批：/memory proposals approve <id>；驳回：/memory proposals dismiss <id>`,
    proposalsUsage: 'proposals 用法：/memory proposals | proposals approve <id> | proposals dismiss <id>',
    proposalNotPending: (id) => `proposal ${JSON.stringify(id)} 不是待审批提案（可能已裁决或不存在）`,
    proposalApproved: (track, scope, text, used, limit) => `已批准提案并写入记忆（${track}/${scope}）：${text}\n该层用量：${used}/${limit}`,
    proposalDismissed: (id) => `已驳回提案 ${id}。`,
    auditEmpty: '审计为空。',
    audit: (n) => `最近审计（${n} 条）：`,
    addNeedsText: 'add 需要文本：/memory add [--track=user|agent] [--scope=user-global|workspace] <文本>',
    added: (track, scope, text, used, limit) => `已添加（${track}/${scope}）：${text}\n该层用量：${used}/${limit}`,
    removeNeedsSubstring: 'remove 需要一个唯一子串：/memory remove [--track=user|agent] [--scope=user-global|workspace] <唯一子串>',
    removed: (track, scope, text, used, limit) => `已删除（${track}/${scope}）：${text}\n该层用量：${used}/${limit}`,
    consolidateUsage: 'consolidate 用法：/memory consolidate [--track=user|agent] [--scope=user-global|workspace] <唯一子串1> [<唯一子串2> ...] => <新文本>',
    consolidateNeedsMatches: 'consolidate 需要 1..20 个唯一子串（=> 左侧）',
    consolidateNeedsText: 'consolidate 需要新文本（=> 右侧）',
    consolidated: (track, scope, removed, text, used, limit) => `已整合（${track}/${scope}）：删除 ${removed} 条，新增 1 条。\n新条目：${text}\n该层用量：${used}/${limit}`,
    exportUsage: 'export 把所有条目 + 预算导出为一份 JSON 文档（只读；可重定向到文件做备份/迁移）：/memory export',
    importUsage: 'import 从导出文档恢复条目（文件路径，或以 { 开头的内联 JSON）：/memory import <路径> | /memory import \'{"plugin":"dsh-memento",...}\'',
    importBadJson: 'import：内联 JSON 无法解析',
    importReadFailed: (path, message) => `import：无法读取 ${JSON.stringify(path)}：${message}`,
    importBadSchema: (schema) => `import：不是 dsh-memento 导出文档（要求 schema "${schema}"）`,
    importNoEntries: 'import：导出文档没有任何条目',
    importTooMany: (max) => `import：导出文档超过 ${max} 条；请拆分后分批导入`,
    importBadEntry: 'import：每条都需要字符串 track、scope 与非空 text',
    imported: (n) => `已导入 ${n} 条记忆（单次审批；预算已复检）。条目获得新 id 与新时间戳；提案、审计行与召回计数不迁移。`,
    adaptersEmpty: '没有已注册的记忆适配器。',
    adaptersList: (n, rows) => `记忆适配器（${n} 个）：\n${rows}\n导入：/memory import --adapter=<id> <路径|内联 JSON>；导出：/memory export --adapter=<id>`,
    adapterExportUsage: '适配器导出用法：/memory export --adapter=<id>（只读转换输出到 stdout）',
    adapterImportUsage: '适配器导入用法：/memory import --adapter=<id> <文件路径>（或以 { 开头的内联 JSON）',
    adapterServiceMissing: '当前 profile 没有记忆适配器注册表',
    adapterBadFlag: '适配器 id 缺失或非法：请用 --adapter=<id>（小写 kebab-case）',
    adapterUnknown: (id) => `没有注册记忆适配器「${id}」；请运行 /memory adapters`,
    adapterPayload: (id, message) => `适配器 ${id} 拒绝了载荷：${message}`,
    adapterImported: (n, id) => `已通过适配器 ${id} 导入 ${n} 条记忆（单次审批；预算已复检）。条目获得新 id 与新时间戳。`,
    unknownVerb: (verb) => `未知子命令「${verb}」。用法：/memory list | query <词> | add <文本> | remove <唯一子串> | consolidate <唯一子串...> => <新文本> | proposals [approve|dismiss <id>] | budgets | audit | adapters | export [--adapter=<id>] | import [--adapter=<id>] <路径>`,
    commandFailed: (message) => `memory 命令失败：${message}`,
  },
})

/** 命令注册描述与输入提示（双语）。 */
const COMMAND_DESCRIPTION = /** @type {{en: {description: string, hint: string}, zh: {description: string, hint: string}}} */ ({
  en: {
    description: 'View/manage dsh-memento memory: list | query <word> | add [--track=user|agent] [--scope=user-global|workspace] <text> | remove <substring> | consolidate <substring...> => <new text> | proposals [approve|dismiss <id>] | budgets | audit | adapters | export [--adapter=<id>] | import [--adapter=<id>] <path>',
    hint: 'list | query <word> | add <text> | remove <substring> | consolidate <substring...> => <new text> | proposals [approve|dismiss <id>] | budgets | audit | adapters | export [--adapter=<id>] | import [--adapter=<id>] <path>',
  },
  zh: {
    description: '查看/管理 dsh-memento 记忆：list | query <词> | add [--track=user|agent] [--scope=user-global|workspace] <文本> | remove <唯一子串> | consolidate <唯一子串...> => <新文本> | proposals [approve|dismiss <id>] | budgets | audit | adapters | export [--adapter=<id>] | import [--adapter=<id>] <路径>',
    hint: 'list | query <词> | add <文本> | remove <唯一子串> | consolidate <唯一子串...> => <新文本> | proposals [approve|dismiss <id>] | budgets | audit | adapters | export [--adapter=<id>] | import [--adapter=<id>] <路径>',
  },
})

/**
 * 注册 /memory 命令（用户触发，非模型回合）。列出/查询/预算/审计/导出直接读；
 * add/remove/consolidate 走 turn 外审批门（同一 waterfall + writePolicy）。命令缺失的
 * profile（headless）自动跳过。
 * @param {import('@deepseek-ai/cordis').Context} ctx - Cordis 上下文。
 * @param {MemoryService} service - ctx.memory。
 */
export function registerCommands(ctx, service) {
  withService(ctx, 'commands', (/** @type {{register?: (def: object) => unknown} | null | undefined} */ commands) => {
    if (typeof commands?.register !== 'function') return
    const meta = COMMAND_DESCRIPTION[service.language] ?? COMMAND_DESCRIPTION.en
    commands.register({
      name: 'memory',
      description: meta.description,
      input: { hint: meta.hint },
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
    const text = COMMAND_TEXT[service.language] ?? COMMAND_TEXT.en
    if (error instanceof MemoryError) return { kind: 'error', text: `memory ${String(error.code)}: ${error.message}` }
    const message = error instanceof Error ? error.message : String(error)
    return { kind: 'error', text: text.commandFailed(message) }
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
  const text = COMMAND_TEXT[service.language] ?? COMMAND_TEXT.en
  const raw = String(invocation?.rawInput ?? '').trim()
  const [verb, ...rest] = raw.split(/\s+/)
  if (verb === undefined || verb.length === 0) {
    return { kind: 'success', text: text.usage }
  }
  switch (verb) {
    case 'list': {
      const { entries, total, truncated } = service.query(
        { limit: service.commandListLimit },
        { sessionId: /** @type {string | undefined} */ (invocation?.agent?.session?.id), session: invocation?.agent?.session },
      )
      if (total === 0) return { kind: 'success', text: text.memoryEmpty }
      const header = truncated ? text.entries(total, entries.length) : text.entriesFull(total)
      return { kind: 'success', text: `${header}\n${entries.map(renderEntryLine).join('\n')}` }
    }
    case 'query': {
      const query = rest.join(' ')
      if (query.length === 0) return { kind: 'error', text: text.queryNeedsWord }
      const { entries, total, truncated } = service.query(
        { text: query, limit: service.commandListLimit },
        { sessionId: /** @type {string | undefined} */ (invocation?.agent?.session?.id), session: invocation?.agent?.session },
      )
      if (total === 0) return { kind: 'success', text: text.noMatch(query) }
      const header = truncated ? text.matches(total, entries.length) : text.matchesFull(total)
      return { kind: 'success', text: `${header}\n${entries.map(renderEntryLine).join('\n')}` }
    }
    case 'budgets': {
      const rows = service.budgets()
      return { kind: 'success', text: `${text.budgets}\n${rows.map((/** @type {{track: string, scope: string, used: number, limit: number}} */ row) => `- ${row.track}/${row.scope}: ${row.used}/${row.limit}`).join('\n')}` }
    }
    case 'proposals': {
      const [sub, id] = rest
      if (sub === undefined) {
        const rows = /** @type {MemoryProposal[]} */ (service.store.proposalList('pending', 50))
        if (rows.length === 0) return { kind: 'success', text: text.proposalsNone }
        const lines = rows.map((proposal) => `- [${proposal.id}] ${proposal.track}/${proposal.scope}: ${proposal.text.length > 120 ? `${proposal.text.slice(0, 120)}…` : proposal.text}`).join('\n')
        return { kind: 'success', text: text.proposalsList(rows.length, lines) }
      }
      if (id === undefined) return { kind: 'error', text: text.proposalsUsage }
      if (sub === 'approve') {
        const proposal = /** @type {MemoryProposal | null} */ (service.store.proposalList('pending', 1000).find((/** @type {MemoryProposal} */ candidate) => candidate.id === id) ?? null)
        if (proposal === null) {
          return { kind: 'error', text: text.proposalNotPending(id) }
        }
        const result = await service.add(
          { track: proposal.track, scope: proposal.scope, text: proposal.text, source: 'proposal', workspaceKey: proposal.workspaceKey, agentKey: proposal.agentKey },
          { agent: invocation?.agent, gate: makeCommandGate(ctx, invocation) },
        )
        try {
          service.store.proposalDecide(id, 'approved')
        } catch (error) {
          // 并发裁决（面板/另一命令已 approve/dismiss）：写已成功，别用提案状态错误掩盖它。
          if (!(error instanceof ProposalNotFoundError)) throw error
        }
        return { kind: 'success', text: text.proposalApproved(proposal.track, proposal.scope, result.entry.text, result.usage.used, result.usage.limit) }
      }
      if (sub === 'dismiss') {
        service.store.proposalDecide(id, 'dismissed')
        return { kind: 'success', text: text.proposalDismissed(id) }
      }
      return { kind: 'error', text: text.proposalsUsage }
    }
    case 'audit': {
      const rows = service.store.auditList(service.commandAuditLimit)
      if (rows.length === 0) return { kind: 'success', text: text.auditEmpty }
      return { kind: 'success', text: `${text.audit(rows.length)}\n${rows.map((/** @type {{ts: number, action: string, track?: string | null, scope?: string | null, outcome?: string | null, source?: string | null}} */ row) => `- ${new Date(row.ts).toISOString()} ${row.action}${row.track ? ` ${row.track}/${row.scope}` : ''} ${row.outcome ?? ''} (${row.source ?? ''})`.trim()).join('\n')}` }
    }
    case 'adapters': {
      const registry = adapterRegistryOf(ctx)
      if (registry === null) return { kind: 'error', text: text.adapterServiceMissing }
      const list = registry.list()
      if (list.length === 0) return { kind: 'success', text: text.adaptersEmpty }
      const rows = list.map((adapter) => `- ${adapter.id} (${adapter.name}, v${adapter.version}): ${adapter.description}\n  import: ${adapter.importFormats.join(', ')}; export: ${adapter.exportFormat}`)
      return { kind: 'success', text: text.adaptersList(list.length, rows.join('\n')) }
    }
    case 'export': {
      const parsed = parseAdapterFlag(rest)
      if (parsed.flagSeen) {
        if (parsed.adapterId === undefined) return { kind: 'error', text: text.adapterBadFlag }
        const registry = adapterRegistryOf(ctx)
        if (registry === null) return { kind: 'error', text: text.adapterServiceMissing }
        const payload = registry.export(parsed.adapterId, service.store.listEntries())
        return { kind: 'success', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }
      }
      if (rest.length > 0) return { kind: 'error', text: text.exportUsage }
      const entries = service.store.listEntries()
      const payload = {
        plugin: 'dsh-memento',
        schema: EXPORT_SCHEMA,
        exportedAt: new Date().toISOString(),
        budgets: service.budgets(),
        entries: entries.map((/** @type {MemoryEntry} */ entry) => ({
          id: entry.id,
          track: entry.track,
          scope: entry.scope,
          workspaceKey: entry.workspaceKey,
          agentKey: entry.agentKey,
          text: entry.text,
          source: entry.source,
          tags: entry.tags,
          version: entry.version,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          lastRecalled: entry.lastRecalled,
          recallCount: entry.recallCount,
        })),
      }
      return { kind: 'success', text: JSON.stringify(payload, null, 2) }
    }
    case 'import': {
      const parsed = parseAdapterFlag(rest)
      if (parsed.flagSeen) {
        if (parsed.adapterId === undefined) return { kind: 'error', text: text.adapterBadFlag }
        return await importViaAdapter(ctx, service, parsed.adapterId, parsed.rest.join(' '), invocation, text)
      }
      const arg = rest.join(' ').trim()
      if (arg.length === 0) return { kind: 'error', text: text.importUsage }
      let payload
      if (arg.startsWith('{')) {
        try {
          payload = JSON.parse(arg)
        } catch {
          return { kind: 'error', text: text.importBadJson }
        }
      } else {
        try {
          payload = JSON.parse(readFileSync(arg, 'utf8'))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return { kind: 'error', text: text.importReadFailed(arg, message) }
        }
      }
      const shape = payload !== null && typeof payload === 'object' ? /** @type {{plugin?: unknown, schema?: unknown, entries?: unknown}} */ (payload) : undefined
      const valid = shape !== undefined && shape.plugin === 'dsh-memento' && shape.schema === EXPORT_SCHEMA && Array.isArray(shape.entries)
      if (!valid) return { kind: 'error', text: text.importBadSchema(EXPORT_SCHEMA) }
      const rawEntries = /** @type {unknown[]} */ (shape.entries)
      if (rawEntries.length === 0) return { kind: 'error', text: text.importNoEntries }
      if (rawEntries.length > MAX_IMPORT_ENTRIES) return { kind: 'error', text: text.importTooMany(MAX_IMPORT_ENTRIES) }
      const entries = []
      for (const raw of rawEntries) {
        if (raw === null || typeof raw !== 'object') return { kind: 'error', text: text.importBadEntry }
        const entry = /** @type {{track?: unknown, scope?: unknown, text?: unknown, source?: unknown, workspaceKey?: unknown, agentKey?: unknown}} */ (raw)
        if (typeof entry.track !== 'string' || typeof entry.scope !== 'string' || typeof entry.text !== 'string' || entry.text.length === 0) {
          return { kind: 'error', text: text.importBadEntry }
        }
        entries.push({
          track: entry.track,
          scope: entry.scope,
          text: entry.text,
          ...(typeof entry.source === 'string' && entry.source.length > 0 ? { source: entry.source } : {}),
          ...(typeof entry.workspaceKey === 'string' && entry.workspaceKey.length > 0 ? { workspaceKey: entry.workspaceKey } : {}),
          ...(typeof entry.agentKey === 'string' && entry.agentKey.length > 0 ? { agentKey: entry.agentKey } : {}),
        })
      }
      // seed 单次审批 + 全量预算预检 + 单事务原子落盘；条目重获新 id 与新时间戳，召回计数归零。
      const result = await service.seed(entries, { agent: invocation?.agent, gate: makeCommandGate(ctx, invocation) })
      return { kind: 'success', text: text.imported(result.added) }
    }
    case 'add': {
      const parsed = parseCommandWrite(rest, true)
      if (parsed.kind === 'error') {
        return { kind: 'error', text: text.addNeedsText }
      }
      const write = { agent: invocation?.agent, gate: makeCommandGate(ctx, invocation) }
      const result = await service.add(
        { track: parsed.track, scope: parsed.scope, text: parsed.text, source: 'command' },
        write,
      )
      return { kind: 'success', text: text.added(parsed.track, parsed.scope, result.entry.text, result.usage.used, result.usage.limit) }
    }
    case 'remove': {
      const parsed = parseCommandWrite(rest, true)
      if (parsed.kind === 'error') return { kind: 'error', text: text.removeNeedsSubstring }
      const result = await service.remove(
        { track: parsed.track, scope: parsed.scope, match: parsed.text },
        { agent: invocation?.agent, gate: makeCommandGate(ctx, invocation) },
      )
      return { kind: 'success', text: text.removed(parsed.track, parsed.scope, result.entry.text, result.usage.used, result.usage.limit) }
    }
    case 'consolidate': {
      const joined = rest.join(' ')
      const separator = joined.indexOf(' => ')
      if (separator === -1) {
        return { kind: 'error', text: text.consolidateUsage }
      }
      let track = 'user'
      let scope = 'workspace'
      const matches = []
      for (const part of joined.slice(0, separator).split(/\s+/)) {
        const trackMatch = /^--track=(user|agent)$/.exec(part)
        if (trackMatch !== null) { track = trackMatch[1]; continue }
        const scopeMatch = /^--scope=(user-global|workspace)$/.exec(part)
        if (scopeMatch !== null) { scope = scopeMatch[1]; continue }
        if (part.length > 0) matches.push(part)
      }
      const newText = joined.slice(separator + 4).trim()
      if (matches.length === 0 || matches.length > 20) return { kind: 'error', text: text.consolidateNeedsMatches }
      if (newText.length === 0) return { kind: 'error', text: text.consolidateNeedsText }
      const result = await service.consolidate(
        { track, scope, matches, text: newText, source: 'command' },
        { agent: invocation?.agent, gate: makeCommandGate(ctx, invocation) },
      )
      return { kind: 'success', text: text.consolidated(track, scope, result.removed.length, result.entry.text, result.usage.used, result.usage.limit) }
    }
    default:
      return { kind: 'error', text: text.unknownVerb(verb) }
  }
}

/** 读取 ctx.memoryAdapters（命令路径用）；缺失返回 null（headless 未挂载时响亮报缺）。 */
function adapterRegistryOf(/** @type {import('@deepseek-ai/cordis').Context} */ ctx) {
  const registry = ctx.get('memoryAdapters')
  if (registry === null || typeof registry !== 'object' || typeof /** @type {{list?: unknown}} */ (registry).list !== 'function') return null
  return /** @type {MemoryAdapterRegistry} */ (registry)
}

/** 解析 --adapter=<id> 标志（export/import 共用；返回 {adapterId, rest, flagSeen}）。 */
function parseAdapterFlag(/** @type {string[]} */ args) {
  const rest = []
  let adapterId
  let flagSeen = false
  for (const arg of args) {
    const match = /^--adapter=([a-z0-9][a-z0-9-]*)$/.exec(arg)
    if (match !== null) {
      flagSeen = true
      adapterId = match[1]
      continue
    }
    if (arg.startsWith('--adapter')) flagSeen = true
    rest.push(arg)
  }
  return { adapterId, rest, flagSeen }
}

/**
 * 适配器导入：外部载荷（文件或内联 JSON）→ 适配器转换 → service.seed（单次审批 +
 * 全量预算预检 + 单事务原子落盘，逐条落审计）。转换失败/未知适配器响亮报错。
 * @param {import('@deepseek-ai/cordis').Context} ctx - Cordis 上下文。
 * @param {MemoryService} service - ctx.memory。
 * @param {string} adapterId - 适配器 id。
 * @param {string} rawArg - 文件路径或内联 JSON。
 * @param {{rawInput?: unknown, agent?: {session?: MemorySessionLike | null} | null, signal?: AbortSignal}} invocation - 命令调用。
 * @param {CommandTextBundle} text - 文案包。
 * @returns {Promise<{kind: 'success' | 'error', text: string}>}。
 */
async function importViaAdapter(ctx, service, adapterId, rawArg, invocation, text) {
  const registry = adapterRegistryOf(ctx)
  if (registry === null) return { kind: 'error', text: text.adapterServiceMissing }
  const arg = rawArg.trim()
  if (arg.length === 0) return { kind: 'error', text: text.adapterImportUsage }
  /** @type {unknown} */
  let payload
  if (arg.startsWith('{')) {
    try {
      payload = JSON.parse(arg)
    } catch {
      return { kind: 'error', text: text.importBadJson }
    }
  } else {
    try {
      const rawText = readFileSync(arg, 'utf8')
      try {
        payload = JSON.parse(rawText)
      } catch {
        // markdown 适配器（hermes-memory-md / claude-code-memory-md）直接收原文。
        payload = rawText
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { kind: 'error', text: text.importReadFailed(arg, message) }
    }
  }
  let entries
  try {
    entries = registry.adapt(adapterId, payload).entries
  } catch (error) {
    if (error instanceof AdapterNotFoundError) {
      return { kind: 'error', text: text.adapterUnknown(adapterId) }
    }
    const message = error instanceof Error ? error.message : String(error)
    return { kind: 'error', text: text.adapterPayload(adapterId, message) }
  }
  if (entries.length === 0) return { kind: 'error', text: text.importNoEntries }
  if (entries.length > MAX_IMPORT_ENTRIES) return { kind: 'error', text: text.importTooMany(MAX_IMPORT_ENTRIES) }
  const result = await service.seed(entries, { agent: invocation?.agent, gate: makeCommandGate(ctx, invocation) })
  return { kind: 'success', text: text.adapterImported(result.added, adapterId) }
}

/** 命令写参数解析：--track/--scope 可选（默认 user/workspace，与工具一致），余下为文本。 */
function parseCommandWrite(/** @type {string[]} */ args, /** @type {boolean} */ requireText) {  let track = 'user'
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

/** 条目渲染行（命令/面板共用格式；workspace 条目带 @工作区键，非共享 agent 条目带 #agent 键）。 */
function renderEntryLine(/** @type {{track: string, scope: string, workspaceKey?: string, agentKey?: string, text: string}} */ entry) {
  const workspaceTag = entry.scope === 'workspace' ? ` @${entry.workspaceKey}` : ''
  const agentTag = typeof entry.agentKey === 'string' && entry.agentKey.length > 0 ? ` #${entry.agentKey}` : ''
  return `- [${entry.track}/${entry.scope}${workspaceTag}${agentTag}] ${entry.text}`
}

/**
 * memory_recall 工具（F11）：语义不明确时把记忆 query 与近期会话历史合并
 * 返回两段式召回（"记忆 + 历史会话"）。sessionQuery 服务缺失时降级为纯记忆
 * 结果（history 段为空，绝不报错）。
 * @param {MemoryService} service - ctx.memory。
 * @param {import('@deepseek-ai/cordis').Context} ctx - Cordis 上下文（查 sessionQuery）。
 * @param {{historyLimitDefault: number, snippetCap: number, snippetChars: number, windowDays: number}} recall - Config.recall（默认值）。
 * @param {'en'|'zh'} [language] - 'en' | 'zh'。
 * @param {import('./lib/retrieval.mjs').RetrievalProvider | null} [retriever] - 语义检索器；
 *   null = 默认 substring 主路径（走 service.query 的 SQL instr）。
 * @returns {object} 工具定义。
 */
export function makeMemoryRecallTool(service, ctx, recall, language = 'en', retriever = null) {
  const description = language === 'zh'
    ? [
      '对记忆与会话历史的两段式召回：返回 (1) dsh-memento 库中与查询匹配的有界记忆条目，以及 (2) 经 session-query 服务的近期会话历史匹配。',
      '当仅凭记忆查询有歧义、或答案可能在更早的对话而非记忆中时使用。普通记忆查询请优先用 memory 工具的 action=query。',
      '查询对记忆条目是大小写不敏感子串（与 memory 工具一致），对会话历史是大小写不敏感语义文本扫描。',
    ].join('\n')
    : [
      'Two-part recall over memory and session history: returns (1) bounded memory entries matching the query from the dsh-memento store, and (2) recent session-history matches via the session-query service.',
      'Use when a memory query alone is ambiguous or when the answer may live in an earlier conversation rather than in memory. For plain memory lookup prefer the memory tool with action=query.',
      'The query is a case-insensitive substring for memory entries (same as the memory tool) and a case-insensitive semantic-text scan for session history.',
    ].join('\n')
  const parameters = language === 'zh'
    ? {
        query: '两个数据源的大小写不敏感检索词。',
        memoryLimit: '最多返回的记忆条目数（默认 10）。',
        historyLimit: '最多扫描的历史会话数（默认 8）。',
      }
    : {
        query: 'Case-insensitive search terms for both sources.',
        memoryLimit: 'Max memory entries to return (default 10).',
        historyLimit: 'Max history sessions to scan (default 8).',
      }
  return defineTool({
    name: 'memory_recall',
    description,
    parameters: {
      query: { type: 'string', required: true, description: parameters.query },
      memoryLimit: { type: 'integer', description: parameters.memoryLimit },
      historyLimit: { type: 'integer', description: parameters.historyLimit },
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
      render: (/** @type {object} */ _args, /** @type {RecallToolValue} */ value) => renderMemoryRecallResult(_args, value, language),
    },
    execute: /** @type {(args: any, exec: any) => Promise<any>} */ (async (args, exec) => {
      exec.signal.throwIfAborted()
      const sessionId = /** @type {string | undefined} */ (exec.agent?.session?.id)
      const session = /** @type {MemorySessionLike | null | undefined} */ (exec.agent?.session ?? null)
      const agentKey = agentKeyOf(/** @type {string | undefined} */ (exec.agent?.session?.header?.agentPreset))
      const limit = args.memoryLimit ?? 10
      const memory = retriever === null
        ? service.query({ text: args.query, limit }, { sessionId, session, agentKey })
        : recallViaRetriever(service, retriever, args.query, limit, { sessionId, session, agentKey })
      const history = await recallHistory(
        ctx,
        args.query,
        args.historyLimit ?? recall.historyLimitDefault,
        recall.snippetCap,
        recall.snippetChars,
        exec.signal,
        /** @type {string | undefined} */ (exec.agent?.session?.header?.cwd),
        recall.windowDays,
      )
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
 * 语义召回路径（retrieval seam 的 Consumer 面）：可见条目 → 检索器排序 → 召回计数
 * + 审计。与 service.query 的子串路径对齐：命中页召回计数 +1（bumpRecall）、带
 * sessionId 时记 recalled 审计行。可见集 = 会话 cwd 工作区层 + 共享/本 agent 层
 * （与快照 visibleEntries 同语义）。
 * @param {MemoryService} service - ctx.memory（提供 store）。
 * @param {import('./lib/retrieval.mjs').RetrievalProvider} retriever - 语义检索器。
 * @param {string} query - 检索词。
 * @param {number} limit - 返回上限。
 * @param {{sessionId?: string, session?: MemorySessionLike | null, agentKey: string}} opts - {sessionId, session, agentKey}。
 * @returns {MemoryQueryResult}。
 */
function recallViaRetriever(service, retriever, query, limit, opts) {
  const workspaceKey = workspaceKeyOf(/** @type {string | undefined} */ (opts.session?.header?.cwd))
  const entries = visibleEntries(
    /** @type {Array<{id: string, track: string, scope: string, workspaceKey: string, agentKey: string, text: string, createdAt: number}>} */ (service.store.listEntries()),
    workspaceKey,
    opts.agentKey,
  )
  const ranked = /** @type {MemoryEntry[]} */ (retriever.retrieve(query, entries))
  const shown = ranked.slice(0, limit)
  service.store.bumpRecall(shown.map((entry) => entry.id))
  if (opts.sessionId !== undefined) {
    service.store.auditAppend({
      action: 'recalled',
      text: query,
      outcome: 'ok',
      source: /** @type {string} */ (service.sourceLabel),
      sessionId: opts.sessionId,
    })
  }
  return { entries: shown, total: ranked.length, truncated: ranked.length > shown.length }
}

/**
 * 近期会话历史召回（sessionQuery 可选；rc.6 记录形状 = {header:{id}}，事件为元数据记录）。
 * 服务端下推：filterSessions 以会话 cwd（原值直传，harness 按存储值比较）与
 * created-at 时间窗收窄候选，再对前 N 个候选做 filterEvents 定位——从"全量列举 +
 * 每候选一次扫描"变为"一次过滤 + ≤N 次定位"。
 * @param {import('@deepseek-ai/cordis').Context} ctx - Cordis 上下文（查 sessionQuery）。
 * @param {string} query - 检索词。
 * @param {number} limit - 最多扫描的会话数。
 * @param {number} snippetCap - 每个会话最多展示的片段数。
 * @param {number} snippetChars - 每个片段的最大字符数。
 * @param {AbortSignal} signal - 取消信号。
 * @param {string | undefined} cwd - 当前会话 cwd（服务端 cwd 过滤；缺省不加该过滤器）。
 * @param {number} windowDays - 时间窗（天）；>0 时加 created-at 下界。
 * @returns {Promise<{available: boolean, sessions: Array<{sessionId: string, matches: number, snippets: string[]}>, error?: string}>}。
 */
async function recallHistory(ctx, query, limit, snippetCap, snippetChars, signal, cwd, windowDays) {
  const sessionQuery = ctx.get('sessionQuery')
  if (sessionQuery === undefined || sessionQuery === null) {
    return { available: false, sessions: [] }
  }
  const queryService = /** @type {{filterSessions: (filters: object[], signal?: AbortSignal) => Promise<Array<{header?: {id?: unknown}}>>, filterEvents: (sessionId: string, filters: object[]) => Promise<Array<{seq: number}>>, readSession: (sessionId: string) => Promise<{session?: unknown, events: Array<{seq: number, type?: string, data?: unknown}>}>}} */ (sessionQuery)
  try {
    const sessionFilters = []
    if (typeof cwd === 'string' && cwd.length > 0) {
      sessionFilters.push({ kind: 'cwd', values: [cwd] })
    }
    if (Number.isInteger(windowDays) && windowDays > 0) {
      sessionFilters.push({ kind: 'created-at', from: Date.now() - windowDays * 86400000 })
    }
    const records = await queryService.filterSessions(sessionFilters, signal)
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
        for (const hit of matched.slice(0, snippetCap)) {
          const event = bySeq.get(hit.seq)
          if (event === undefined) continue
          const text = extractEventText(event)
          if (text.length > 0) snippets.push(text.length > snippetChars ? `${text.slice(0, snippetChars)}…` : text)
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
 * memory_recall 结果渲染（纯函数；language 选文案，未知回退 en）。
 * @param {object} _args - 调用参数（未用）。
 * @param {object} value - 规范 JSON 结果。
 * @param {string} [language] - 'en' | 'zh'。
 * @returns {Array<{type: 'text', text: string}>} 模型可见文本。
 */
export function renderMemoryRecallResult(/** @type {object} */ _args, /** @type {RecallToolValue} */ value, language = 'en') {
  const zh = language === 'zh'
  const memoryLine = value.memory.total === 0
    ? (zh ? 'memory：没有条目命中' : 'memory: no entries matched')
    : (zh
        ? `memory：${value.memory.entries.length} 条命中${value.memory.truncated ? `（共 ${value.memory.total} 条）` : ''}\n${value.memory.entries.map((entry) => `- [${entry.track}/${entry.scope}] ${entry.text}`).join('\n')}`
        : `memory: ${value.memory.entries.length} match${value.memory.entries.length === 1 ? '' : 'es'}${value.memory.truncated ? ` (of ${value.memory.total})` : ''}\n${value.memory.entries.map((entry) => `- [${entry.track}/${entry.scope}] ${entry.text}`).join('\n')}`)
  const historyLines = []
  if (!value.history.available) {
    historyLines.push(value.history.error === undefined
      ? (zh ? 'history：本 profile 未提供 session-query 服务' : 'history: session-query unavailable in this profile')
      : (zh ? `history：session-query 失败（${value.history.error}）` : `history: session-query failed (${value.history.error})`))
  } else if (value.history.sessions.length === 0) {
    historyLines.push(zh ? 'history：没有匹配的会话' : 'history: no matching sessions')
  } else {
    for (const session of value.history.sessions) {
      historyLines.push(zh
        ? `- 会话 ${session.sessionId}：${session.matches} 条事件命中`
        : `- session ${session.sessionId}: ${session.matches} event match${session.matches === 1 ? '' : 'es'}`)
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
 * @param {{panelEntriesLimit: number, panelAuditLimit: number}} options - Config 面板上限。
 */
export function registerWebRoutes(ctx, service, options) {
  withService(ctx, 'webServer', (/** @type {{register?: (route: object) => (() => void) | undefined} | null | undefined} */ webServer) => {
    if (typeof webServer?.register !== 'function') return
    // webServer.register 返回的 disposer 是唯一注销途径（重复 exact 路由会抛
    // duplicate route），不随 fiber 自动撤销：逐个收集，末尾挂进一个
    // ctx.effect，fiber 卸载时逆序摘除全部路由。
    /** @type {Array<(() => void) | undefined>} */
    const routeDisposers = []
    routeDisposers.push(webServer.register({
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
          const limit = raw === undefined ? undefined : (Number.isInteger(raw) && raw > 0 ? Math.min(raw, options.panelEntriesLimit) : undefined)
          const { entries, total, truncated } = service.query({
            ...filter,
            ...(limit === undefined ? {} : { limit }),
          })
          sendPanelJson(res, 200, { entries, total, truncated, budgets: service.budgets(), language: service.language })
        } catch (error) {
          sendPanelJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }))
    routeDisposers.push(webServer.register({
      kind: 'exact',
      path: '/api/memento/audit',
      handler: async (/** @type {{url?: string}} */ req, /** @type {PanelResponse} */ res) => {
        try {
          const url = new URL(req.url ?? '', 'http://localhost')
          const raw = Number(url.searchParams.get('limit') ?? String(options.panelAuditLimit))
          const limit = Number.isInteger(raw) && raw > 0 ? Math.min(raw, PANEL_AUDIT_CEILING) : options.panelAuditLimit
          sendPanelJson(res, 200, { rows: service.store.auditList(limit), language: service.language })
        } catch (error) {
          sendPanelJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }))
    routeDisposers.push(webServer.register({
      kind: 'exact',
      path: '/api/memento/proposals',
      handler: async (/** @type {{url?: string}} */ _req, /** @type {PanelResponse} */ res) => {
        try {
          // 只读：仅列出 pending 提案；approve/dismiss 走 /memory 命令（用户动作 + 审批门）。
          sendPanelJson(res, 200, { proposals: service.store.proposalList('pending', 50), language: service.language })
        } catch (error) {
          sendPanelJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }))
    // 路由随插件生命周期撤销：fiber 卸载时逆序执行全部 disposer。
    ctx.effect(() => () => {
      for (const dispose of routeDisposers.splice(0).reverse()) dispose?.()
    }, 'memento: web panel routes')
  })
}

/** 面板 JSON 响应（node:http）。 */
function sendPanelJson(/** @type {PanelResponse} */ res, /** @type {number} */ status, /** @type {unknown} */ value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

export { MemoryError, InvalidInputError, BudgetExceededError, EntryNotFoundError, AmbiguousMatchError, WriteDeniedError, NoAgentError, ProposalNotFoundError, AdapterNotFoundError, AdapterPayloadError }
export { buildWriteReason, isMemoryWriteRequest, applyWritePolicy, normalizeWritePolicy, resolveWritePolicy, validateWritePolicies, parseWriteReason }
export { openMemoryStore, resolveDbPath }
export { renderSnapshot, visibleEntries }
export { workspaceKeyOf }
export { validateBudgets, budgetReport, budgetLimits, checkBudget }
export { MemoryProtocolCore, PROTOCOL_ID, PROTOCOL_VERSION, PROTOCOL_URI, normalizeTags, validateMemoryEntry, validateExportEnvelope, validateAuditRow, MAX_TAGS_PER_ENTRY, MAX_TAG_LENGTH }
export { MemoryAdapterRegistry }
export { REFERENCE_ADAPTERS }
