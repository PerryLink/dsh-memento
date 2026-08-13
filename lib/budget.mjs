// lib/budget.mjs — 预算计算（零 DSH 依赖，纯函数）。
//
// 每轨每层硬字符预算：user 轨默认 2000/层，agent 轨默认 4000/层（Config
// budgets 可覆盖；中文场景按需调大并在 PR 说明理由）。计数单位是 JS 字符串
// 长度（UTF-16 code unit）：一个汉字计 1，与用户直觉一致且可预测。
// 写满必须报错（BUDGET_EXCEEDED），绝不静默截断、绝不自动压缩。

import { TRACKS, SCOPES } from './constants.mjs'

/**
 * (track, scope) 的当前字符用量。
 * @param {Array<{track: string, scope: string, text: string}>} entries - 该组条目。
 * @param {string} track - 轨道。
 * @param {string} scope - 作用域。
 * @returns {number} 文本长度之和。
 */
export function entryUsage(entries, track, scope) {
  let used = 0
  for (const entry of entries) {
    if (entry.track === track && entry.scope === scope) used += entry.text.length
  }
  return used
}

/**
 * 全量用量行：每个 track×scope 一行。
 * @param {Array<{track: string, scope: string, text: string}>} entries - 全部条目。
 * @returns {Array<{track: string, scope: string, used: number}>} 按轨道/作用域顺序排列。
 */
export function usageRows(entries) {
  const rows = []
  for (const track of TRACKS) {
    for (const scope of SCOPES) {
      rows.push({ track, scope, used: entryUsage(entries, track, scope) })
    }
  }
  return rows
}

/**
 * 预算检查：当前用量 + 增量是否超限。
 * @param {number} used - 当前用量。
 * @param {number} limit - 硬上限。
 * @param {number} addition - 本次新增字符数（可为负，表示 replace 后的净变化）。
 * @returns {{ok: true} | {ok: false, used: number, limit: number, needed: number}} 纯结果。
 */
export function checkBudget(used, limit, addition) {
  const needed = used + addition
  if (needed > limit) return { ok: false, used, limit, needed }
  return { ok: true }
}

/**
 * 完整预算报表：每行携带上限。
 * @param {Array<{track: string, scope: string, text: string}>} entries - 全部条目。
 * @param {object} budgets - 形状 {user: {userGlobal, workspace}, agent: {userGlobal, workspace}}。
 * @returns {Array<{track: string, scope: string, used: number, limit: number}>}。
 */
export function budgetReport(entries, budgets) {
  const limits = budgetLimits(budgets)
  return usageRows(entries).map((row) => ({ ...row, limit: limits[row.track][row.scope] }))
}

/**
 * 把 Config.budgets 规范化为 {track: {scope: limit}} 双键表。
 * @param {object} budgets - Config.budgets（含 userGlobal/workspace 键）。
 * @returns {object} {user: {'user-global': number, workspace: number}, agent: {...}}。
 */
export function budgetLimits(budgets) {
  return {
    user: {
      'user-global': budgets.user.userGlobal,
      workspace: budgets.user.workspace,
    },
    agent: {
      'user-global': budgets.agent.userGlobal,
      workspace: budgets.agent.workspace,
    },
  }
}

/**
 * 校验 budgets 配置形状：所有上限必须是正整数；缺失/非法在加载期响亮失败。
 * @param {object} budgets - 原始配置。
 * @returns {{ok: true, limits: object} | {ok: false, message: string}}。
 */
export function validateBudgets(budgets) {
  if (budgets === null || typeof budgets !== 'object') {
    return { ok: false, message: 'budgets must be an object with user/agent tracks and userGlobal/workspace layers' }
  }
  const limits = {}
  for (const track of TRACKS) {
    const trackConfig = budgets[track]
    if (trackConfig === null || typeof trackConfig !== 'object') {
      return { ok: false, message: `budgets.${track} must be an object` }
    }
    const layerLimits = {}
    for (const scope of SCOPES) {
      const key = scope === 'user-global' ? 'userGlobal' : scope
      const limit = trackConfig[key]
      if (typeof limit !== 'number' || !Number.isInteger(limit) || limit <= 0) {
        return { ok: false, message: `budgets.${track}.${key} must be a positive integer` }
      }
      layerLimits[scope] = limit
    }
    limits[track] = layerLimits
  }
  return { ok: true, limits }
}
