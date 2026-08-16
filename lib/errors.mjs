// lib/errors.mjs — 结构化错误（零 DSH 依赖）。
//
// 所有领域失败都以 MemoryError（或其子类）抛出：携带稳定 code 与 JSON 安全
// details，供工具层转成规范 JSON 结果（ok:false + error 对象）。基础设施失败
// （store 损坏等）也走本家族，绝不以字符串错误静默吞掉。

import { ERROR_CODES } from './constants.mjs'

/**
 * dsh-memento 领域错误基类：稳定 code + 可公开的 details。
 * @param {string} code - ERROR_CODES 成员之一。
 * @param {string} message - 人类可读描述（中文，面向用户与模型）。
 * @param {object} [details] - 附加事实（usage/limit/candidates 等，必须 JSON 安全）。
 */
export class MemoryError extends Error {
  constructor(/** @type {string} */ code, /** @type {string} */ message, /** @type {{[key: string]: unknown}} */ details = {}) {
    super(message)
    this.name = 'MemoryError'
    this.code = code
    this.details = details
  }

  /** @returns {{code: string, message: string} & Record<string, unknown>} 工具结果里的规范错误对象。 */
  toPublic() {
    return { code: this.code, message: this.message, ...this.details }
  }
}

/** 非法输入（空文本、越界轨道/作用域、缺失必填字段）。 */
export class InvalidInputError extends MemoryError {
  /** @param {string} message - 描述哪一项非法。 */
  constructor(message) {
    super(ERROR_CODES.INVALID_INPUT, message)
    this.name = 'InvalidInputError'
  }
}

/**
 * 预算超限：写入会使 (track, scope) 字符用量超过硬上限。
 * @param {object} d - {track, scope, used, limit, needed}。
 */
export class BudgetExceededError extends MemoryError {
  constructor(/** @type {{track: string, scope: string, used: number, limit: number, needed: number}} */ d) {
    super(
      ERROR_CODES.BUDGET_EXCEEDED,
      `memory budget exceeded: ${d.track}/${d.scope} at ${d.used}/${d.limit} chars, this write needs ${d.needed} chars; consolidate or remove entries, then retry`,
      d,
    )
    this.name = 'BudgetExceededError'
  }
}

/** 子串未命中任何条目。 */
export class EntryNotFoundError extends MemoryError {
  /** @param {{track: string, scope: string, match: string}} d - {track, scope, match}。 */
  constructor(d) {
    super(
      ERROR_CODES.ENTRY_NOT_FOUND,
      `no entry in ${d.track}/${d.scope} contains ${JSON.stringify(d.match)}; nothing was changed`,
      d,
    )
    this.name = 'EntryNotFoundError'
  }
}

/** 子串命中多条：要求模型给更具体的唯一子串。 */
export class AmbiguousMatchError extends MemoryError {
  /**
   * @param {{track: string, scope: string, match: string, candidates: number, sample: string[]}} d - {track, scope, match, candidates, sample}；sample 是截断后的候选文本。
   */
  constructor(d) {
    super(
      ERROR_CODES.AMBIGUOUS_MATCH,
      `match ${JSON.stringify(d.match)} is ambiguous in ${d.track}/${d.scope}: ${d.candidates} entries contain it; use a longer, unique substring`,
      d,
    )
    this.name = 'AmbiguousMatchError'
  }
}

/** 审批未放行（rejected/cancelled/unavailable），或写策略为 off。 */
export class WriteDeniedError extends MemoryError {
  /**
   * @param {string} outcome - ApprovalOutcome 之一。
   * @param {string} [detail] - 附加原因（如审批服务抛错），拼进消息。
   */
  constructor(outcome, detail) {
    super(
      ERROR_CODES.WRITE_DENIED,
      `memory write not approved (approval outcome: ${outcome}${detail === undefined ? '' : `; ${detail}`}); nothing was written`,
      { outcome },
    )
    this.name = 'WriteDeniedError'
  }
}

/** 插件被禁用（enabled:false）时调用写/读服务。 */
export class DisabledError extends MemoryError {
  constructor() {
    super(ERROR_CODES.DISABLED, 'dsh-memento is disabled by configuration; no memory service is available')
    this.name = 'DisabledError'
  }
}

/** 提案不存在或已裁决（approve/dismiss 目标必须是 pending 提案）。 */
export class ProposalNotFoundError extends MemoryError {
  /**
   * @param {string} id - 提案 id。
   * @param {string} [detail] - 附加原因（如已裁决的状态）。
   */
  constructor(id, detail) {
    super(
      ERROR_CODES.PROPOSAL_NOT_FOUND,
      `proposal ${JSON.stringify(id)} is not a pending proposal${detail === undefined ? '' : ` (${detail})`}; nothing was changed`,
      { id },
    )
    this.name = 'ProposalNotFoundError'
  }
}

/** 写路径缺少 agent（无法路由审批）：一律失败封闭，绝不静默放行。 */
export class NoAgentError extends MemoryError {
  constructor() {
    super(
      ERROR_CODES.NO_AGENT,
      'memory write requires an owning agent session to route approval through; refuse rather than write unapproved',
    )
    this.name = 'NoAgentError'
  }
}

/** 记忆库损坏/版本过新：加载期或最早可解析点响亮失败。 */
export class StoreError extends MemoryError {
  /**
   * @param {string} code - STORE_CORRUPT 或 STORE_UNSUPPORTED_VERSION。
   * @param {string} message - 具体原因。
   * @param {{[key: string]: unknown}} [details] - {path} 等。
   */
  constructor(code, message, /** @type {{[key: string]: unknown}} */ details = {}) {
    super(code, message, details)
    this.name = 'StoreError'
  }
}

/** 适配器注册表里不存在该适配器 id（调用方拼错或插件未注册）。 */
export class AdapterNotFoundError extends MemoryError {
  /** @param {string} adapterId - 未注册的适配器 id。 */
  constructor(adapterId) {
    super(
      ERROR_CODES.ADAPTER_NOT_FOUND,
      `no memory adapter registered with id ${JSON.stringify(adapterId)}; check /memory adapters for the registered list`,
      { adapterId },
    )
    this.name = 'AdapterNotFoundError'
  }
}

/** 适配器载荷无法按文档化格式转换（结构不合法或该适配器明确不支持的形状）。 */
export class AdapterPayloadError extends MemoryError {
  /**
   * @param {string} adapterId - 适配器 id。
   * @param {string} message - 具体哪一处不合法。
   */
  constructor(adapterId, message) {
    super(ERROR_CODES.ADAPTER_PAYLOAD, `adapter ${JSON.stringify(adapterId)}: ${message}`, { adapterId })
    this.name = 'AdapterPayloadError'
  }
}
