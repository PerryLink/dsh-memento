// types.d.ts — dsh-memento 类型契约（声明合并）。
//
// 本插件入口是纯 ESM JavaScript；类型契约集中在本文件：
// - `declare module '@deepseek-ai/cordis'`：ctx.memory 服务（F1，三角色 seam 的
//   Service Definition 面）。
// - `declare module '@deepseek-ai/dsh-session'`：memory/* 会话事件词汇（F7）。
//   rc.8 复核（2026-08-21）：harness 仍无插件事件注册面
//   （KNOWN_SESSION_EVENT_TYPES 不含 memory/*，Session.append 写入面也仍不接受
//   ignorable 标记），运行时按已知集合自适应派发——未被 harness 收录时跳过
//   append，审计由审批审计对 + 插件审计表承担；词汇与载荷形状在本文件定死，
//   harness 收录后即自动启用。

export type MemoryTrack = 'user' | 'agent'

export type MemoryScope = 'user-global' | 'workspace'

export type MemoryWritePolicy = 'ask' | 'auto' | 'off'

export type MemoryAction = 'add' | 'replace' | 'remove' | 'consolidate' | 'query' | 'seed'

/** 落盘条目（审计/会话事件的载荷形状）。 */
export interface MemoryEntry {
  /** 条目 id（本插件生成，UUID v4，跨会话稳定）。 */
  id: string
  /** 轨道：user=用户画像，agent=环境事实/约定/教训。 */
  track: MemoryTrack
  /** 作用域：user-global 跨工作区，workspace 按会话 cwd。 */
  scope: MemoryScope
  /** workspace 条目的规范化 cwd 键；user-global 条目为空串。 */
  workspaceKey: string
  /** 规范化 agentPreset 键；'' = 共享层（所有 preset 可见）。 */
  agentKey: string
  /** 条目文本（预算计数字符 = JS 字符串长度）。 */
  text: string
  /** 来源标注（dsh-memento / memory-tool / claude 等）。 */
  source: string
  /** 短标签（协议 v1：最多 16 个、每个 ≤32 字符；顺序 = 首次出现序）。 */
  tags: string[]
  /** 条目版本（协议 v1：新条目 = 1；每次 replace 自增）。 */
  version: number
  /** 创建时间（epoch ms）。 */
  createdAt: number
  /** 最近更新时间（epoch ms）。 */
  updatedAt: number
  /** 最近召回时间（epoch ms）；从未命中为 null。 */
  lastRecalled: number | null
  /** 召回次数（query 排序用：高频即重要）。 */
  recallCount: number
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
  /** 显式 agentKey；省略时取写方会话 agentPreset。 */
  agentKey?: string
  /** 短标签（协议 v1 条目规范；缺省 = 无标签）。 */
  tags?: string[]
}

/** 会话最小形状（插件只读这些面；字段宽类型以兼容真实 Session/Agent）。 */
export interface MemorySessionLike {
  id?: unknown
  header?: { cwd?: unknown; agentPreset?: unknown }
  append?: (type: string, data: unknown) => unknown
}

/** 审批服务最小形状（插件消费的 seam 面）。 */
export interface MemoryApprovalLike {
  request(req: { agent?: unknown; toolName?: string; reason?: string; callId?: unknown; signal?: AbortSignal }): Promise<string>
  overrideOf?(session: unknown): string | undefined
  config?: { policy?: string }
}

/** 写上下文：审批路由与审计归属所必需。agent 缺失时写失败封闭。 */
export interface MemoryWriteContext {
  /** 发起写的 agent（其 session 承载审批审计对）。 */
  agent: { session?: MemorySessionLike | null } | null | undefined
  /** 发起写的工具 callId（供 UI answerer 挂靠已流式化的工具调用）。 */
  callId?: unknown
  /** 取消信号：中止即 cancelled，不写任何东西。 */
  signal?: AbortSignal
  /** 可选自定义审批传输（turn 外命令路径注入；payload 携带完整写载荷）。 */
  gate?: (payload: { action: string; track: string; scope: string; text: string; count?: number }, write: MemoryWriteContext) => Promise<string>
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
  /** 模型可见文案与命令输出的语言（Config.language，'en' | 'zh'）。 */
  language: 'en' | 'zh'

  /** 每轨每层当前用量与上限。 */
  budgets(): MemoryBudgetRow[]

  /** 子串查询（无审批）；带 sessionId 时记 recalled 审计，带 session 时按已知事件类型自适应派发 memory/recalled。
   *  opts.agentKey 给定时按会话可见集过滤（共享层 + 指定 agent 键）；缺省不过滤（管理面全量视图）。 */
  query(filter?: { track?: MemoryTrack; scope?: MemoryScope; text?: string; limit?: number }, opts?: { sessionId?: string; session?: MemorySessionLike | null; agentKey?: string }): MemoryQueryResult

  /** 新增条目（审批门 + 预算门）。 */
  add(input: MemoryEntryInput, write: MemoryWriteContext): Promise<{ entry: MemoryEntry; usage: MemoryUsage }>

  /** 按唯一子串替换（审批门 + 预算门；零/多命中报错）。写定位 = 会话可见集：
   *  agentKey/workspaceKey 显式给定则覆盖写方会话的推导值。审批载荷携带将被改写的旧条目全文。 */
  replace(input: { track: MemoryTrack; scope: MemoryScope; match: string; text: string; source?: string; agentKey?: string; workspaceKey?: string; tags?: string[] }, write: MemoryWriteContext): Promise<{ previous: MemoryEntry; entry: MemoryEntry; usage: MemoryUsage }>

  /** 按唯一子串删除（审批门；零/多命中报错）。写定位 = 会话可见集；审批载荷携带将被删除的条目全文。 */
  remove(input: { track: MemoryTrack; scope: MemoryScope; match: string; agentKey?: string; workspaceKey?: string }, write: MemoryWriteContext): Promise<{ entry: MemoryEntry; usage: MemoryUsage }>

  /** 整合多条为一条（一次审批 + Provider 单事务原子执行；零/多命中或超预算响亮失败）。 */
  consolidate(input: { track: MemoryTrack; scope: MemoryScope; matches: string[]; text: string; source?: string; workspaceKey?: string; agentKey?: string; tags?: string[] }, write: MemoryWriteContext): Promise<{ removed: MemoryEntry[]; entry: MemoryEntry; usage: MemoryUsage }>

  /** 批量种子（一次 ask 审批整批；任一条超预算整批拒绝）。 */
  seed(inputs: MemoryEntryInput[], write: MemoryWriteContext): Promise<{ added: number; entries: MemoryEntry[] }>
}

/** 适配器描述（/memory adapters 与接入指南展示面）。 */
export interface MemoryAdapterDescriptor {
  /** 唯一适配器 id（小写 kebab-case）。 */
  id: string
  /** 人类可读名称。 */
  name: string
  /** 一句话说明转换方向与适用格式。 */
  description: string
  /** 适配器自身版本。 */
  version: string
  /** 可导入的外部格式标签。 */
  importFormats: string[]
  /** 导出产出的外部格式标签。 */
  exportFormat: string
}

/** 适配器契约（第三方记忆插件实现面）：外部格式 ⇄ 协议条目。 */
export interface MemoryAdapter extends MemoryAdapterDescriptor {
  /** 外部载荷 → 协议条目输入（只转换，绝不调模型抽取）。 */
  adapt(payload: unknown): { entries: MemoryEntryInput[] }
  /** 协议条目 → 外部载荷（JSON 安全，只读转换）。 */
  export(entries: MemoryEntry[]): unknown
}

/** ctx.memoryAdapters 服务（dsh-memory-protocol v1 适配器注册表）。 */
export interface MemoryAdaptersService {
  /** 注册适配器（返回 disposer；id 冲突响亮失败）。 */
  register(adapter: MemoryAdapter): () => void
  /** 已注册适配器描述（按 id 排序）。 */
  list(): MemoryAdapterDescriptor[]
  /** 外部载荷 → 协议条目输入（未知 id / 非法载荷结构化报错）。 */
  adapt(adapterId: string, payload: unknown): { entries: MemoryEntryInput[] }
  /** 协议条目 → 外部格式载荷（只读）。 */
  export(adapterId: string, entries: MemoryEntry[]): unknown
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** dsh-memento 记忆服务（本插件提供；其它插件可读写同一 store）。 */
    memory: MemoryService
    /** dsh-memory-protocol v1 适配器注册表（本插件提供；第三方记忆插件注册自己的适配器）。 */
    memoryAdapters: MemoryAdaptersService
    /** 审批 seam（本插件消费的最小面；由 DSH interaction 能力提供）。 */
    approval: MemoryApprovalLike
  }
  interface Events {
    /** 审批 waterfall（本插件 answerer 挂链）。 */
    'approval/request'(req: unknown, next: () => Promise<string>): Promise<string>
    /** 可选服务就绪通知（withService 用）。 */
    'internal/service'(name: string): void
    /** 会话事件桥（auto-capture 等观察面用）。 */
    'session/event'(session: unknown, event: unknown): void
  }
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /**
     * 一条记忆条目已落盘（审批通过后的写成功）。日志只读事件，非 surface；
     * 审计链 = approval/asked + approval/decided + 本事件 + 插件审计表。
     * rc.8 无插件事件注册面时运行时跳过 append（见 types.d.ts 头注）。
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
