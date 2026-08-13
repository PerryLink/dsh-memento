# ARCHITECTURE

`dsh-memento` 的架构文档：三角色 seam、数据流、以及每个关键设计决策的理由。面向对象：插件维护者与想接入 `ctx.memory` 的其它插件作者（如 dsh-claude-move 的 seed 集成）。

## 三角色 seam

本插件是完整的能力接缝（Service Definition / Provider / Consumer 三角色齐全），与"只做记忆仓库"的插件有本质区别：

```
┌─────────────────────────────────────────────────────────────────────┐
│  Consumer：memory 工具（F5）          Consumer：冻结快照注入（F6）      │
│  - add/replace/remove/query           - systemPrompt 段，order=-50    │
│  - 规范 JSON + 纯 render              - 会话首 assemble 时同步读库     │
│  - 尊重 exec.signal                   - WeakMap 按 Session 冻结       │
└───────────────┬──────────────────────────────┬──────────────────────┘
                │ 写（带 exec.agent/callId）      │ 读（同步，session cwd）
                ▼                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Service Definition：ctx.memory（F1，index.mjs MemoryService）        │
│  budgets()  add()  replace()  remove()  query()  seed()              │
│                                                                     │
│  写路径（不可绕过的审批门，S3）：                                      │
│    预算预检 ──▶ ctx.approval.request ──▶ 预算复审 ──▶ 落盘 ──▶ 审计    │
│              （审批对 approval/asked+decided 自动入会话日志）           │
│  读路径：无审批；query 带 sessionId 时记 recalled 审计行               │
└───────────────┬─────────────────────────────────────────────────────┘
                │ 同步 SQL（node:sqlite，单连接串行）
                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Provider：lib/store.mjs（F2，本地 SQLite，WAL，零依赖）               │
│  entries：双轨×双层×文本 + 元数据（来源/时间/会话 id/workspace_key）    │
│  audit：  插件自有审计账本（动作/结果/审批来源/会话 id）                │
│  唯一子串匹配用 instr()；零/多命中报错；事务内 replace/remove 原子      │
└─────────────────────────────────────────────────────────────────────┘
```

设计目标：将来任何插件（包括 dsh-claude-move 的 `seed(source:'claude')`）都能向同一个 store 喂数据、读数据——store 是同一份，信任门在 Service 层统一把守。

## 数据流（一次写 → 下次会话可见）

```
memory 工具(add)
  → MemoryService.add（预算预检：store.usage + checkBudget）
  → ctx.approval.request（toolName:'memory'，reason 携带完整载荷 [dsh-memento] 前缀）
      ├─ 审批服务先裁决会话级 policy（never 不可绕过）
      └─ waterfall：本插件 answerer（prepend）按 writePolicy 裁决
           ask → 委托 UI answerer（人类批准/拒绝）
           auto → allowed-once；off → rejected
  → outcome === allowed-once 才继续（否则 WriteDeniedError，零落盘）
  → 预算复审（审批等待期间用量可能变化，此刻为权威）
  → store.insertEntry + audit 行（outcome 含 policy 来源）
  → 会话日志（已知事件类型）已有 approval/asked+decided 审计对
  → 下一会话首个 assemble：渲染冻结快照（带用量头）注入 systemPrompt 段
     └ 同一文本也写入 audit(snapshot) 行 + request/header.system（S2 可重建）
```

## 关键设计决策

1. **快照注入走 systemPrompt 段（而非 pre-step sourced message）**。
   - `snapshotOrder` 直接映射段顺序语义（默认 -50：harness identity(-100) 之后、persona(0) 之前）；
   - rc.6 已证明的路径：`assemble.agent.session.header.cwd` 提供工作区作用域（dsh-claude-move 同款）；
   - 渲染文本随 `request/header` 事件逐字落会话日志（system 字段），加上 `audit(snapshot)` 行，S2 可重建有两条独立证据链；
   - 冻结语义 = systemPrompt 全文会话内不变 = 前缀缓存稳定（这正是"冻结快照"的设计目的）。
   代价与约束：提供者必须同步（rc.6 不 await），SQLite 同步读 + WeakMap 冻结满足 N1。

2. **审批门做在 Service 写方法内部，不在工具层**（对应 Hermes issue #48181 教训）。
   - 任何路径（memory 工具、其它插件、未来 /memory 命令）只要调 `ctx.memory.add/replace/remove/seed` 就必然经过 `ctx.approval.request`；
   - `writePolicy` 是 Config（ask/auto/off，默认 ask），模型不可见、不可改；
   - 本插件在 `approval/request` 上注册 prepend answerer：只认领 toolName='memory' 且 reason 带 `[dsh-memento]` 前缀的请求；ask 委托续链（人类 answerer），auto/off 直接裁决；
   - 会话级 `approval/never` 由审批服务在 answerer 之前裁决，任何 answerer（含 prepend）都无法绕过——本插件遵从该硬不变量。

3. **预算在 Service 层双重校验（审批前后各一次），Provider 层绝不截断**。
   - 预检在打扰用户之前拒绝明显超限；复审以审批等待后的真实用量为权威（期间可能有其它写）；
   - 写满抛结构化 `BUDGET_EXCEEDED`（含 used/limit/needed），由模型整合/删除后重试；绝不自动压缩、绝不静默截断；
   - 计数单位是 JS 字符（UTF-16 code unit）：中文场景一个汉字计 1，预算可预测，按需调大（默认 user 2000 / agent 4000 字符/层）。

4. **memory/* 会话事件：词汇已声明，运行时自适应派发（rc.6 约束）**。
   - `types.d.ts` 声明合并了 `memory/added|updated|removed|recalled|snapshot` 的 SessionEventMap 词汇与载荷形状；
   - rc.6 无插件事件注册面：`KNOWN_SESSION_EVENT_TYPES` 不含 memory/*，且 `Session.append` 无法标记 `ignorable`——append 未注册类型会让该会话下次加载被持久化层整体拒绝（read 路径 enforce，见 session-persistence coordinator）；
   - 因此运行时只在 `KNOWN_SESSION_EVENT_TYPES.has(type)` 时才 append（未来 harness 收录后自动开启）；当前审计链 = approval/asked+decided（已知类型，reason 携带完整写载荷）+ 插件审计表 audit。这是与官方机制对齐后的必然选择，不是偷工减料。

5. **审计 = 审批对 + 审计表 + 快照三条链**。
   - 每次写：approval/asked（reason 全文载荷）→ approval/decided（结果）→ audit 行（outcome 含 policy 来源、entry id、会话 id）；
   - 每次 recall：audit(recalled) 行；每次快照：audit(snapshot) 行（与注入文本逐字一致）；
   - 卸载插件后：记忆库与会话日志保留，旧会话可正常加载（因为从不 append 未注册事件类型）。

6. **替换/删除的并发与回滚**。
   - replace/remove 在 Provider 层事务内"定位+变更"原子执行；Service 层审批前先定位（零/多命中不打扰用户）；
   - 审批期间条目被并发写移除：审批后重定位失败即结构化报错（响亮，不静默）。
   - seed 整批先全量预算预检，通过后同步插入（无 await 间隔），不存在部分写入。

7. **工作区键**：workspace 条目按会话 cwd 的规范化绝对值隔离；Windows 下大小写不敏感（同一项目以不同大小写路径打开仍命中同一 workspace 层）。两个进程共用一个 `$DSH_HOME` 时，SQLite 以 busy_timeout 串行写，但"谁先写谁赢"，跨进程一致性不保证（学 Hermes 的官方警告，见 README 安全边界）。

## 配置面（无硬编码 tunable）

全部字段可 cordis.yml 覆盖，schema 见 `index.mjs` 的 `Config`：`enabled` / `dbPath` / `budgets`（user/agent × userGlobal/workspace）/ `writePolicy` / `snapshotOrder` / `maxEntriesPerQuery`。非法值加载期响亮失败。
