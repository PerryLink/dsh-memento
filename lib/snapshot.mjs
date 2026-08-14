// lib/snapshot.mjs — 冻结快照渲染（零 DSH 依赖，纯函数）。
//
// 会话启动时把当前记忆渲染成带用量头的冻结块，经 systemPrompt 段注入
// （system-prompt/assemble 提供 agent，section order = Config.snapshotOrder，
// 默认 -50：harness identity(-100) 之后、persona(0) 之前）。会话内记忆变更
// 只落盘+落审计，不更新已注入快照（冻结语义 = 前缀缓存稳定）。

import { TRACKS, SCOPES } from './constants.mjs'
import { budgetReport } from './budget.mjs'
import { GROUP_TITLES, SNAPSHOT_HEADER, PROPOSAL_HEADER, pick } from './strings.mjs'

/**
 * @typedef {object} SnapshotEntry - 快照渲染看到的条目面。
 * @property {string} id
 * @property {string} track
 * @property {string} scope
 * @property {string} workspaceKey
 * @property {string} agentKey
 * @property {string} text
 * @property {number} createdAt
 */

/**
 * 过滤某个会话可见的条目：agentKey 为 ''（共享层）或匹配会话 agentKey；scope
 * user-global 全见；workspace 只匹配该会话的 workspaceKey（会话 cwd 的规范化绝对值）。
 * @param {SnapshotEntry[]} entries - 全部条目。
 * @param {string} workspaceKey - 会话 cwd 的规范化绝对值。
 * @param {string} [agentKey] - 会话 agentPreset 的规范化键；'' = 共享层。
 * @returns {SnapshotEntry[]} 可见条目。
 */
export function visibleEntries(entries, workspaceKey, agentKey = '') {
  return entries.filter((entry) =>
    (entry.agentKey === '' || entry.agentKey === agentKey)
    && (entry.scope === 'user-global' || (entry.scope === 'workspace' && entry.workspaceKey === workspaceKey)))
}

/**
 * 把条目按 (track, scope) 分组并组内按创建时间排序。
 * @param {SnapshotEntry[]} entries - 可见条目。
 * @returns {Map<string, SnapshotEntry[]>} key = 'track/scope'，值按 createdAt,id 升序。
 */
export function groupEntries(entries) {
  const groups = new Map()
  for (const entry of entries) {
    const key = `${entry.track}/${entry.scope}`
    const list = groups.get(key)
    if (list === undefined) groups.set(key, [entry])
    else list.push(entry)
  }
  for (const list of groups.values()) {
    list.sort((/** @type {SnapshotEntry} */ a, /** @type {SnapshotEntry} */ b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }
  return groups
}

/**
 * @typedef {object} SnapshotProposal - 快照渲染看到的提案面。
 * @property {string} id
 * @property {string} track
 * @property {string} scope
 * @property {string} workspaceKey
 * @property {string} agentKey
 * @property {string} text
 */

/**
 * 过滤某个会话可见的提案：与条目可见性同一语义（agentKey 共享/匹配 +
 * scope 规则）。
 * @param {SnapshotProposal[]} proposals - 全部 pending 提案。
 * @param {string} workspaceKey - 会话 cwd 的规范化绝对值。
 * @param {string} [agentKey] - 会话 agentPreset 的规范化键；'' = 共享层。
 * @returns {SnapshotProposal[]} 可见提案。
 */
export function visibleProposals(proposals, workspaceKey, agentKey = '') {
  return proposals.filter((proposal) =>
    (proposal.agentKey === '' || proposal.agentKey === agentKey)
    && (proposal.scope === 'user-global' || (proposal.scope === 'workspace' && proposal.workspaceKey === workspaceKey)))
}

/**
 * 渲染冻结快照全文（含每分组用量头）。无任何条目时返回空串——空段不进提示词，
 * 空记忆零 token 成本。带 pending 提案时追加提案块（模型可见 ⟺ 随快照文本
 * 进入 request/header.system，S2 可重建）。
 * @param {SnapshotEntry[]} entries - 会话可见条目。
 * @param {{user: {userGlobal: number, workspace: number}, agent: {userGlobal: number, workspace: number}}} budgets - Config.budgets。
 * @param {SnapshotProposal[]} [proposals] - 会话可见 pending 提案。
 * @param {string} [language] - 'en' | 'zh'（默认 en）。
 * @returns {string} 快照文本。
 */
export function renderSnapshot(entries, budgets, proposals = [], language = 'en') {
  const groups = groupEntries(entries)
  const report = budgetReport(entries, budgets)
  const titles = /** @type {Record<string, string>} */ (pick(GROUP_TITLES, language))
  const header = /** @type {string} */ (pick(SNAPSHOT_HEADER, language))
  const proposalHeader = /** @type {string} */ (pick(PROPOSAL_HEADER, language))
  const usageSuffix = language === 'zh' ? '已用字符' : 'chars used'
  const sections = []
  for (const track of TRACKS) {
    for (const scope of SCOPES) {
      const key = `${track}/${scope}`
      const list = groups.get(key)
      if (list === undefined || list.length === 0) continue
      const row = report.find((candidate) => candidate.track === track && candidate.scope === scope)
      sections.push(`## ${titles[key]} — ${row.used}/${row.limit} ${usageSuffix}\n${list.map((entry) => `- ${entry.text}`).join('\n')}`)
    }
  }
  if (proposals.length > 0) {
    sections.push([
      `## ${proposalHeader}`,
      proposals.map((proposal) => `- [${proposal.id}] ${proposal.track}/${proposal.scope}: ${proposal.text}`).join('\n'),
    ].join('\n'))
  }
  if (sections.length === 0) return ''
  return [header, ...sections].join('\n\n')
}
