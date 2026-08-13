// test/helpers/fixtures.mjs — 合成记忆夹具（永不掺真实用户记忆）。
//
// 快照/预算/匹配测试共用的合成数据集：形状与 store 条目一致，内容为编造的
// 通用示例，与任何真实项目/人物无关。

import { workspaceKeyOf } from '../../lib/workspace.mjs'

/**
 * 合成条目工厂（createdAt 递增，保证排序确定）。
 * @param {Array<object>} defs - {id, track, scope, text, workspaceKey?, source?}。
 * @returns {Array<object>} store 条目形状。
 */
export function makeEntries(defs) {
  let clock = 1700000000000
  return defs.map((def) => {
    clock += 1000
    return {
      id: def.id,
      track: def.track,
      scope: def.scope,
      workspaceKey: def.workspaceKey ?? (def.scope === 'workspace' ? workspaceKeyOf('C:\\work\\proj') : ''),
      text: def.text,
      source: def.source ?? 'fixture',
      createdAt: clock,
      updatedAt: clock,
      sessionId: null,
    }
  })
}

/** 覆盖双轨×双层的合成数据集（V1 默认预算下的典型规模）。 */
export const TYPICAL_ENTRIES = makeEntries([
  { id: 'u-global-1', track: 'user', scope: 'user-global', text: '用户偏好：回复一律使用中文，除非明确要求英文' },
  { id: 'u-global-2', track: 'user', scope: 'user-global', text: '雷区：不要替用户做任何 git push' },
  { id: 'u-ws-1', track: 'user', scope: 'workspace', text: '本项目的验证命令是 npm test' },
  { id: 'a-global-1', track: 'agent', scope: 'user-global', text: '环境事实：CI 使用 GitHub Actions，Windows 自托管' },
  { id: 'a-ws-1', track: 'agent', scope: 'workspace', text: '项目约定：测试先于实现，提交必须附测试' },
  { id: 'a-ws-2', track: 'agent', scope: 'workspace', text: '教训：曾因跳过迁移备份丢失数据，迁移前必须备份' },
])

/** 故意构造的子串歧义数据集（replace/remove 歧义错误测试用）。 */
export const AMBIGUOUS_ENTRIES = makeEntries([
  { id: 'a', track: 'user', scope: 'user-global', text: '偏好中文回复' },
  { id: 'b', track: 'user', scope: 'user-global', text: '偏好中文注释' },
])

/** 夹具自检：形状完整、时间递增、workspace 键一致。 */
export function assertFixtureShape(entries) {
  for (const entry of entries) {
    if (typeof entry.id !== 'string' || entry.id.length === 0) throw new Error(`fixture entry lacks id: ${JSON.stringify(entry)}`)
    if (typeof entry.text !== 'string' || entry.text.length === 0) throw new Error(`fixture entry lacks text: ${JSON.stringify(entry)}`)
    if (!['user', 'agent'].includes(entry.track)) throw new Error(`fixture entry bad track: ${JSON.stringify(entry)}`)
    if (!['user-global', 'workspace'].includes(entry.scope)) throw new Error(`fixture entry bad scope: ${JSON.stringify(entry)}`)
    if (!Number.isInteger(entry.createdAt)) throw new Error(`fixture entry bad createdAt: ${JSON.stringify(entry)}`)
  }
}
