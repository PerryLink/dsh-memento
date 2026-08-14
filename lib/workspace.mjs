// lib/workspace.mjs — 工作区键与 agent 键（零 DSH 依赖）。
//
// workspace 层按会话 cwd 隔离：写时与快照时用同一个规范化函数生成键，
// Windows 下大小写不敏感（盘符/路径大小写差异不产生两个隔离层）。
// agent 键按 SessionHeader.agentPreset 隔离：'' = 共享层（未按 preset 组合的
// 部署全部落在同一层，行为与无此维度时一致）。

import path from 'node:path'

/**
 * 把会话 cwd 规范化为 workspaceKey。空/非法 cwd 得到 ''（共享"无工作区"层，
 * 仅测试与无 cwd 会话可达；正常 DSH 会话 cwd 必为绝对路径）。
 * @param {string|undefined|null} cwd - 会话 cwd。
 * @returns {string} 规范化键。
 */
export function workspaceKeyOf(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) return ''
  const resolved = path.resolve(cwd)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/**
 * 把会话的 agentPreset 规范化为 agentKey。空/缺失得到 ''（共享层）。
 * @param {string|undefined|null} agentPreset - SessionHeader.agentPreset。
 * @returns {string} 规范化键。
 */
export function agentKeyOf(agentPreset) {
  if (typeof agentPreset !== 'string' || agentPreset.length === 0) return ''
  const trimmed = agentPreset.trim()
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed
}
