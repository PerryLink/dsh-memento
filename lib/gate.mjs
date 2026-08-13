// lib/gate.mjs — 审批门策略（零 DSH 依赖，纯逻辑）。
//
// 写策略（Config.writePolicy，模型不可见、不可改）：
// - ask：委托审批链上其余 answerer（Web UI 人类审批 / ACP 一次性决策），无
//   answerer 时审批服务按失败封闭给出 unavailable → 写被拒。
// - auto：本插件 answerer 直接放行（allowed-once）；审批来源仍随 approval/asked
//   + approval/decided 审计对与审计表记录。
// - off：本插件 answerer 直接拒绝（rejected），写报结构化错误。
// 注意：会话级 ApprovalPolicy='never'（用户全局姿态）在审批服务内部、answerer
// 之前裁决，任何 answerer（含 prepend 注册的本插件）都无法绕过——这是 DSH
// 审批 seam 的硬不变量，本插件设计上遵从它。

import { TOOL_NAME, REQUEST_MARKER, WRITE_POLICIES } from './constants.mjs'
import { InvalidInputError } from './errors.mjs'

/**
 * 判断一条审批请求是否为本插件发出的记忆写请求。
 * 认领条件：toolName === 'memory' 且 reason 带 [dsh-memento] 前缀——防止误伤
 * 其它插件以同名工具身份发出的审批请求。
 * @param {object} req - ApprovalRequest 形状。
 * @returns {boolean} 是否本插件的记忆写请求。
 */
export function isMemoryWriteRequest(req) {
  return req !== null && typeof req === 'object'
    && req.toolName === TOOL_NAME
    && typeof req.reason === 'string'
    && req.reason.startsWith(REQUEST_MARKER)
}

/**
 * 构造审批 reason：第一行人类可读摘要，随后是完整载荷文本。
 * reason 随 approval/asked 进入会话日志（已知事件类型、可持久化），
 * S2 的"变更可自会话日志重建"由此成立。
 * @param {object} input - {action, track, scope, text, count?}；count 用于 seed 批量。
 * @returns {string} 审批 reason。
 */
export function buildWriteReason({ action, track, scope, text, count }) {
  const batch = count === undefined ? '' : ` (${count} entries)`
  return `${REQUEST_MARKER} ${action}${batch} ${track}/${scope}\n${text}`
}

/**
 * 从审批 reason 解析回结构化载荷（审计/重建用）。
 * @param {string} reason - buildWriteReason 的产物。
 * @returns {{action: string, track: string, scope: string, text: string, count?: number} | null}
 *   无法解析返回 null（调用方据此响亮报错）。
 */
export function parseWriteReason(reason) {
  const match = /^\[dsh-memento\] ([a-z]+)(?: \((\d+) entries\))? ([a-z]+)\/([a-z-]+)\n([\s\S]*)$/.exec(reason)
  if (match === null) return null
  return {
    action: match[1],
    ...(match[2] === undefined ? {} : { count: Number(match[2]) }),
    track: match[3],
    scope: match[4],
    text: match[5],
  }
}

/**
 * 对记忆写请求应用写策略（answerer 本体）。
 * @param {string} policy - writePolicy。
 * @param {object} req - ApprovalRequest（已通过 isMemoryWriteRequest 认领）。
 * @param {() => Promise<string>} next - waterfall 续链（ask 时委托人类 answerer）。
 * @returns {Promise<string>} ApprovalOutcome 之一。
 */
export async function applyWritePolicy(policy, req, next) {
  if (!WRITE_POLICIES.includes(policy)) {
    throw new InvalidInputError(`invalid writePolicy ${JSON.stringify(policy)} (one of ${WRITE_POLICIES.join('|')})`)
  }
  if (policy === 'auto') return 'allowed-once'
  if (policy === 'off') return 'rejected'
  return next()
}

/**
 * 校验并归一化写策略（加载期响亮失败）。
 * @param {unknown} policy - 原始配置值。
 * @returns {string} 合法策略原值。
 */
export function normalizeWritePolicy(policy) {
  if (!WRITE_POLICIES.includes(policy)) {
    throw new InvalidInputError(`invalid writePolicy ${JSON.stringify(policy)} (one of ${WRITE_POLICIES.join('|')})`)
  }
  return policy
}
