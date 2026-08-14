// lib/strings.mjs — 模型可见/命令面文案（零 DSH 依赖，纯数据）。
//
// 语言词表：en 为源文（冻结现状），zh 为本次新写的对应译文。渲染函数用
// pick(strings, language) 选表；语言词汇本身在 index.mjs 的 Config.language
// （默认 en，非法值加载期响亮失败）。

/** 快照冻结说明头。 */
export const SNAPSHOT_HEADER = {
  en: '[dsh-memento: frozen memory snapshot — captured at session start; memory changes during this session do not update this block. To change memory, use the memory tool.]',
  zh: '[dsh-memento：冻结记忆快照——会话启动时捕获；本会话内的记忆变更不更新此块。要修改记忆，请使用 memory 工具。]',
}

/** 快照分组标题（模型可见；en 与 DSH 核心提示一致，zh 为对应译文）。 */
export const GROUP_TITLES = {
  en: {
    'user/user-global': 'User profile (global preferences, communication style, landmines)',
    'user/workspace': 'User preferences for this workspace',
    'agent/user-global': 'Environment facts and conventions (cross-workspace)',
    'agent/workspace': 'Workspace facts, conventions, and lessons',
  },
  zh: {
    'user/user-global': '用户画像（全局偏好、沟通风格、雷区）',
    'user/workspace': '本工作区的用户偏好',
    'agent/user-global': '环境事实与约定（跨工作区）',
    'agent/workspace': '本工作区的事实、约定与教训',
  },
}

/** 快照待审批提案块标题。 */
export const PROPOSAL_HEADER = {
  en: 'Pending memory proposals (reviewed by the user; approve or dismiss via the /memory proposals command)',
  zh: '待审批记忆提案（由用户裁决；用 /memory proposals 命令 approve 或 dismiss）',
}

/**
 * 按语言选文案表（未知语言回退 en；调用方已在加载期校验词汇）。
 * @param {Record<string, unknown>} table - 语言键 → 文案。
 * @param {string} language - 'en' | 'zh'。
 * @returns {unknown} 所选文案。
 */
export function pick(table, language) {
  return table[language] ?? table.en
}
