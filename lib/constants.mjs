// lib/constants.mjs — dsh-memento 词汇表与协议常量（零 DSH 依赖）。
//
// 本文件只放协议级常量（词汇、错误码、存储格式版本）。部署可调参数一律走
// index.mjs 的 Schemastery Config，绝不在此写死 tunable。

/** 记忆轨道（双轨分家）：user=用户画像，agent=环境事实/约定/教训。 */
export const TRACKS = /** @type {readonly ['user', 'agent']} */ (['user', 'agent'])

/** 分层作用域：user-global 跨工作区，workspace 按会话 cwd。 */
export const SCOPES = /** @type {readonly ['user-global', 'workspace']} */ (['user-global', 'workspace'])

/** 写策略（Config.writePolicy）：ask=用户审批，auto=放行但记录审批来源，off=拒绝。 */
export const WRITE_POLICIES = ['ask', 'auto', 'off']

/** 审批请求里标识本插件记忆写动作的工具名（审批 answerer 据此认领请求）。 */
export const TOOL_NAME = 'memory'

/** 审批 reason 前缀（含方括号）：answerer 只认领带本前缀的 memory 写请求，防止误伤同工具名的其它请求。 */
export const REQUEST_MARKER = '[dsh-memento]'

/** 记忆库 schema 版本（单调递增；旧版只读迁移，新版响亮拒绝）。 */
export const SCHEMA_VERSION = 1

/** 数据库文件名（位于 $DSH_HOME/dsh-memento/ 下）。 */
export const DEFAULT_DB_NAME = 'memory.db'

/** 条目默认来源标注（seed 写 source: 'claude' 时除外）。 */
export const DEFAULT_SOURCE = 'dsh-memento'

/** Provider 层查询返回硬上限：显式 limit 的钳制天花板（防模型/面板拉爆上下文）。 */
export const MAX_QUERY_LIMIT = 1000

/** 结构化错误码：工具与面板据此分支，模型据此决定"整合后重试"还是"放弃"。 */
export const ERROR_CODES = {
  DISABLED: 'MEMORY_DISABLED',
  INVALID_INPUT: 'INVALID_INPUT',
  NO_AGENT: 'WRITE_REQUIRES_AGENT',
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  ENTRY_NOT_FOUND: 'ENTRY_NOT_FOUND',
  AMBIGUOUS_MATCH: 'AMBIGUOUS_MATCH',
  WRITE_DENIED: 'WRITE_DENIED',
  STORE_CORRUPT: 'STORE_CORRUPT',
  STORE_UNSUPPORTED_VERSION: 'STORE_UNSUPPORTED_VERSION',
  MISSING_DSH_HOME: 'MISSING_DSH_HOME',
}

/** 会话事件名（SessionEventMap 声明合并的词汇表；运行时按已知类型自适应派发）。 */
export const SESSION_EVENTS = {
  added: 'memory/added',
  updated: 'memory/updated',
  removed: 'memory/removed',
  recalled: 'memory/recalled',
  snapshot: 'memory/snapshot',
}
