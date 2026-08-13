// types.d.ts — dsh-memento 类型契约（声明合并）。
//
// 本插件入口是纯 ESM JavaScript；类型契约集中在本文件：
// - `declare module '@deepseek-ai/cordis'`：ctx.memory 服务（F1，三角色 seam 的
//   Service Definition 面）。
// - `declare module '@deepseek-ai/dsh-session'`：memory/* 会话事件词汇（F7）。
//   注意 rc.6 尚无插件事件注册面（KNOWN_SESSION_EVENT_TYPES 不含 memory/*，
//   且 Session.append 无法标记 ignorable），运行时按已知集合自适应派发——
//   未被 harness 收录时跳过 append，审计由审批审计对 + 插件审计表承担；
//   词汇与载荷形状在本文件定死，harness 收录后即自动启用。

export type MemoryTrack = 'user' | 'agent'

export type MemoryScope = 'user-global' | 'workspace'

export type MemoryWritePolicy = 'ask' | 'auto' | 'off'

export type MemoryAction = 'add' | 'replace' | 'remove' | 'query' | 'seed'

/** 落盘条目（审计/会话事件的载荷形状）。 */
export interface MemoryEntry {
  /** 条目 id（本插件生成，跨会话稳定）。 */
  id: string
  /** 轨道：user=用户画像，agent=环境事实/约定/教训。 */
  track: MemoryTrack
  /** 作用域：user-global 跨工作区，workspace 按会话 cwd。 */
  scope: MemoryScope
  /** workspace 条目的规范化 cwd 键；user-global 条目为空串。 */
  workspaceKey: string
  /** 条目文本（预算计数字符 = JS 字符串长度）。 */
  text: string
  /** 来源标注（dsh-memento / memory-tool / claude 等）。 */
  source: string
  /** 创建时间（epoch ms）。 */
  createdAt: number
  /** 最近更新时间（epoch ms）。 */
  updatedAt: number
  /** 最近一次写它的会话 id；无则 null。 */
  sessionId: string | null
}

/** 写入输入（add/seed 用）。 */
export interface MemoryEntryInput {
  track: MemoryTrack
  scope: MemoryScope
  text: string
  source?: string
  /** 显式 workspaceKey；省略时取写方会话 cwd。 */
  workspaceKey?: string
}

/** 写上下文：审批路由与审计归属所必需。agent 缺失时写失败封闭。 */
export interface MemoryWriteContext {
  /** 发起写的 agent（其 session 承载审批审计对）。 */
  agent: unknown
  /** 发起写的工具 callId（供 UI answerer 挂靠已流式化的工具调用）。 */
  callId?: unknown
  /** 取消信号：中止即 cancelled，不写任何东西。 */
  signal?: AbortSignal
}

/** query 结果。 */
export interface MemoryQueryResult {
  entries: MemoryEntry[]
  total: number
  truncated: boolean
}

/** 预算行。 */
export interface MemoryBudgetRow {
  track: MemoryTrack
  scope: MemoryScope
  used: number
  limit: number
}

/** 写成功后的用量（模型据此整合/删除后重试）。 */
export interface MemoryUsage {
  track: MemoryTrack
  scope: MemoryScope
  used: number
  limit: number
}

/** ctx.memory 服务：写方法内部强制过审批门，读方法无审批。 */
export interface MemoryService {
  /** 每轨每层当前用量与上限。 */
  budgets(): MemoryBudgetRow[]

  /** 子串查询（无审批）；带 sessionId 时记 recalled 审计。 */
  query(filter?: { track?: MemoryTrack; scope?: MemoryScope; text?: string; limit?: number }, opts?: { sessionId?: string }): MemoryQueryResult

  /** 新增条目（审批门 + 预算门）。 */
  add(input: MemoryEntryInput, write: MemoryWriteContext): Promise<{ entry: MemoryEntry; usage: MemoryUsage }>

  /** 按唯一子串替换（审批门 + 预算门；零/多命中报错）。 */
  replace(input: { track: MemoryTrack; scope: MemoryScope; match: string; text: string; source?: string }, write: MemoryWriteContext): Promise<{ previous: MemoryEntry; entry: MemoryEntry; usage: MemoryUsage }>

  /** 按唯一子串删除（审批门；零/多命中报错）。 */
  remove(input: { track: MemoryTrack; scope: MemoryScope; match: string }, write: MemoryWriteContext): Promise<{ entry: MemoryEntry; usage: MemoryUsage }>

  /** 批量种子（一次 ask 审批整批；任一条超预算整批拒绝）。 */
  seed(inputs: MemoryEntryInput[], write: MemoryWriteContext): Promise<{ added: number; entries: MemoryEntry[] }>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** dsh-memento 记忆服务（本插件提供；其它插件可读写同一 store）。 */
    memory: MemoryService
  }
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /**
     * 一条记忆条目已落盘（审批通过后的写成功）。日志只读事件，非 surface；
     * 审计链 = approval/asked + approval/decided + 本事件 + 插件审计表。
     * rc.6 无插件事件注册面时运行时跳过 append（见 types.d.ts 头注）。
     */
    'memory/added': {
      entry: MemoryEntry
      source: string
      sessionId: string
    }
    /** 一条记忆条目被 replace 改写（previous 为改写前内容）。 */
    'memory/updated': {
      previous: MemoryEntry
      entry: MemoryEntry
      source: string
      sessionId: string
    }
    /** 一条记忆条目被 remove 删除。 */
    'memory/removed': {
      entry: MemoryEntry
      source: string
      sessionId: string
    }
    /** 一次 query 召回（记录过滤条件与命中数）。 */
    'memory/recalled': {
      query: string
      matches: number
      sessionId: string
    }
    /** 会话启动时注入的冻结快照（text 与模型所见 systemPrompt 段逐字一致，S2）。 */
    'memory/snapshot': {
      text: string
      workspaceKey: string
      at: number
    }
  }
}
