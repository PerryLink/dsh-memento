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
  → outcome === allowed-once 才继续（否则 WriteDeniedError + <action>-denied 审计行，零落盘）
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
   - **审批载荷完整化（approve-what-you-see）**：add/seed 载荷 = 新文本全文；replace 载荷 = `from:\n<旧条目全文>\n\nto:\n<新文本>`；remove 载荷 = 被删条目全文（不再是裸子串）；consolidate 载荷 = 每个目标的定位原文（单条 >300 字截断标注）+ 新文本。人批准的是具体变更而非抽象动作，approval/asked 的 reason 因此携带可重建变更的完整信息。
   - **被拒写也留痕**：`rejected/cancelled/unavailable` 一律在抛出 WriteDeniedError 前落 `<action>-denied` 审计行（outcome 标注真实裁决来源）。turn 内路径另有 approval/asked+decided 审计对；turn 外 gate 路径（/memory 命令）没有审计对可落，denied 行是拒绝的唯一证据链。

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
   - 每次被拒写：`<action>-denied` audit 行（turn 外 gate 路径无审批审计对，这是拒绝证据链）；
   - 每次 recall：audit(recalled) 行；每次快照：audit(snapshot) 行（与注入文本逐字一致）；
   - 卸载插件后：记忆库与会话日志保留，旧会话可正常加载（因为从不 append 未注册事件类型）。

6. **替换/删除的并发与回滚**。
   - replace/remove 在 Provider 层事务内"定位+变更"原子执行；Service 层审批前先定位（零/多命中不打扰用户）；
   - 审批期间条目被并发写移除：审批后重定位失败即结构化报错（响亮，不静默）。
   - seed 整批先全量预算预检，通过后同步插入（无 await 间隔），不存在部分写入。
   - **写定位 = 会话可见集**（决策 11 的可见性语义扩展到写路径）：replace/remove/consolidate 的匹配只命中共享层 + 写方会话 agent 键的条目（显式 `input.agentKey` 覆盖），`workspace` 层再按写方会话 cwd 键过滤——跨 agent、跨工作区条目对会话不可见，也就不可能被误改。
   - 提案裁决（`proposalDecide`）同样在事务内"定位+更新"原子执行：approve 与 dismiss 并发先到者赢；`/memory proposals approve` 在写成功后容忍提案已被并发裁决（不掩盖成功写）。

7. **工作区键**：workspace 条目按会话 cwd 的规范化绝对值隔离；Windows 下大小写不敏感（同一项目以不同大小写路径打开仍命中同一 workspace 层）。两个进程共用一个 `$DSH_HOME` 时，SQLite 以 busy_timeout 串行写，但"谁先写谁赢"，跨进程一致性不保证（学 Hermes 的官方警告，见 README 安全边界）。

8. **V2 观察面的命令写路径（turn 外审批门）**：`/memory` 命令在模型回合之外执行，而审批服务 `ctx.approval.request` 要求 open turn（`approval/asked + approval/decided` 审计对必须被 turn 包围，这是 DSH 持久化日志的 commit/replay 硬边界）。命令写因此走**同一** `approval/request` waterfall（同一 answerer 链、同一 `writePolicy` 裁决），差异只在审计落点：turn 内路径落审批审计对，命令路径落插件审计表 + `command/done`；被拒的命令写落 `<action>-denied` 行（见决策 2）。会话级 `never` 策略按公开 API（`approval.overrideOf`）在派发前预检，与审批服务同语义、不可绕过。这是对审批 seam 约束（审计对需 turn 包围）的最小偏离，已文档化并测试（`test/v2.test.mjs`）。
   - **export/import 备份迁移对**：`/memory export` 是纯只读路径（条目 + 预算的 JSON 导出，schema 标记 `memory-export-v1`，不落审计、不走审批门）。`/memory import <路径>` 或 `import '{...}'`（内联 JSON）读回该文档：校验 plugin/schema 标记与条目形状（未知 schema 版本响亮拒绝），条目数上限 `MAX_IMPORT_ENTRIES`（1000），然后经 `service.seed` 单次审批 + 全量预算预检 + 单事务原子落盘；source/workspaceKey/agentKey 随文档保留，条目获得新 id 与新时间戳、召回计数归零，提案/审计行不迁移（预算仍由 Config 决定）。

9. **V2 面板只读**：Web 面板（`dsh.client` 零构建抽屉）只做条目浏览/搜索/预算条/审计尾；审批与写操作一律发生在 DSH 内置审批 UI + `memory` 工具（否则会与内置审批呈现重复并产生分歧）。

10. **检索引擎 = 大小写不敏感 instr + 召回计数排序，不用 FTS5**。
    - 实测（Node 22 内置 SQLite，FTS5 可用）：trigram 分词器无法索引单字 CJK 字符——`'中文测试'` 中查 `'中文'` 零命中；unicode61 把 CJK 连续段当一个 token，仅前缀可查。本插件语料以中文记忆为主，子串语义必须对 CJK 成立，instr 是唯一正确的内置引擎。
    - query 大小写不敏感（lower() 折叠 ASCII；CJK 无大小写不受影响），与面板过滤、sessionQuery 文本检索语义一致；replace/remove/consolidate 定位同语义（`lib/match.mjs` 的 `findUniqueMatch` 统一折叠，store 层 lower(instr) 与之一致）。
    - 召回排序：query 命中页的条目 `recall_count` +1、`last_recalled` 落地（SCHEMA v3 列）；排序 `recall_count DESC, updated_at DESC`（高频即重要）。快照仍走 `listEntries` 创建序（冻结块稳定优先）。
    - 未来真正的升级路径是 harness 出现 embedding seam 后的语义召回（Provider 角色天然兼容），不是 FTS5——本仓库已按决策 16 落地检索/嵌入 seam 的最小接入。

11. **第三维 agentKey（per-agent 作用域，SCHEMA v3）**。
    - 写方 session 的 `header.agentPreset` 经 `agentKeyOf` 规范化（缺失→'' 共享层）；条目与提案落 `agent_key`。
    - 可见性：`agent_key === '' || === 会话 agentKey`，且 scope 规则不变；预算仍按 track×scope 计（agentKey 不新增预算维度）。
    - **可见性对读与写定位一致生效（0.3.0）**：快照/提案沿用会话可见集；`memory` 工具与 `memory_recall` 的 query 按会话 agentPreset 过滤（`service.query` 的 `opts.agentKey`，显式给定才过滤）；replace/remove/consolidate 的匹配同样按可见集过滤（见决策 6）。管理面（`/memory` 命令、Web 面板）与未传 agentKey 的插件调用保持全量视图（向后兼容），面板与命令列表渲染非共享条目的 agent 键以便管理。
    - 工具不暴露 agentKey 参数——由写方 session 自动决定，模型不可选，避免污染。
    - **可见性对读与写定位一致生效（0.3.0）**：快照/提案沿用会话可见集；`memory` 工具与 `memory_recall` 的 query 按会话 agentPreset 过滤（`service.query` 的 `opts.agentKey`，显式给定才过滤）；replace/remove/consolidate 的匹配同样按可见集过滤（见决策 6）。管理面（`/memory` 命令、Web 面板）与未传 agentKey 的插件调用保持全量视图（向后兼容），面板与命令列表渲染非共享条目的 agent 键以便管理。

12. **语言面（Config.language，en/zh）与错误文案的分界**。
    - 随语言切换的只有**模型可见/命令/面板**文案：`memory`/`memory_recall` 工具描述与参数说明、冻结快照（`lib/strings.mjs` 词表）、`/memory` 命令输出、Web 面板标签（语言经 `/api/memento/*` 响应的 `language` 字段下发）。en 为源文，zh 为对应译文；未知语言回退 en。
    - **错误信息保持英文**：结构化错误码（`INVALID_INPUT`、`BUDGET_EXCEEDED`…）与 message 是跨语言的审计契约，模型按 code 分支（整合后重试等），不受 language 影响。
    - 非法 `language` 值在加载期响亮失败（schema 层 union + apply 直调路径双保险）。默认 `en` 与 DSH 核心提示一致。
    - `/memory export` 是纯只读路径（条目 + 预算的 JSON 导出，备份/迁移/透明性），不落审计、不走审批门——与 Claude Code/Codex"记忆是用户可读的纯文本"精神对齐。

## V3 协同（F12/F13，接口已就位，文档对齐）

### F12：seed 与 dsh-claude-move 的对接方式

`ctx.memory.seed(entries, write)` 已在 V1 实现：一次 `ask` 审批整批、任一条超预算整批拒绝、逐条落审计（source 透传）。dsh-claude-move 接入时的对齐约定：

- 把 Claude `memory/*.md` 解析为条目数组，每条 `{ track: 'agent', scope: 'workspace', text, source: 'claude', workspaceKey }`（workspaceKey 用会话 cwd 规范化键，缺省时取写方 agent 的会话 cwd）；
- 以 `ctx.get('memory')` 可选依赖读取服务（dsh-claude-move 已有 `withService` 同款模式），服务缺失时优雅跳过——**不破坏其现有行为**；
- seed 的 `write.agent` 必须存在（审批路由），dsh-claude-move 的导入命令/工具有 invocation/exec agent 可传入；
- 预算吃紧时 seed 整批失败并返回结构化 `BUDGET_EXCEEDED`，由导入方拆分批次重试。

### F13：auto-review hook 点（不实现第二模型）

本插件暴露的接缝：`write.gate`（写上下文里的可选函数）。默认走 `ctx.approval.request`（turn 内、落审批审计对）；`/memory` 命令在 turn 外以 `makeCommandGate` 注入同一 waterfall 的无审计对变体。未来的 dsh-auto-review 若想接管记忆写审批，可在 `approval/request` 上注册自己的 answerer（先于/取代人类 answerer），无需改本插件一行——审批 answerer 链本身就是 hook 点；`writePolicy` 为 `ask` 时 `applyWritePolicy` 委托 `next()`，任何挂链的第二模型 answerer 都能接管。

## 配置面（无硬编码 tunable）

全部字段可 cordis.yml 覆盖，schema 见 `index.mjs` 的 `Config`；完整字段表（`enabled` / `dbPath` / `budgets` / `writePolicy` / `writePolicies` / `language` / `snapshotOrder` / `maxEntriesPerQuery` / `commandListLimit` / `commandAuditLimit` / `recall.*` / `panelEntriesLimit` / `panelAuditLimit` / `auditRetentionDays` / `proposals.*`）以 README 配置表为准，本文件不再逐项复制以免漂移。非法值加载期响亮失败。
- **harness 主目录回退（0.3.1）**：`dbPath` 为空或相对路径时，基准目录取 `$DSH_HOME`；`dsh web` 启动不会把官方 `resolveDshHome()` 解析出的主目录写回 `process.env.DSH_HOME`，因此未导出时回退 `~/.dsh`（与官方回退同语义）——否则默认 Windows 配置会在真实 boot 时整体崩溃（issue #1）。`lib/` 零 DSH 依赖的红线不允许 import `@deepseek-ai/dsh-home-paths`，用 `os.homedir()` 复刻同一回退。
- **宿主设置面板接入（settings namespace）**：settings 服务挂载时经 `installSection` 注册 `dsh-memento` namespace（`SettingsSchema` = `Config` 去 `enabled` 加 `panel`，base = 组合配置，validate 复用同一业务校验）。生效分两级：热字段（writePolicy(s)/language/budgets/各 limit/proposals/panel）经 watch 即时生效——answerer 与命令门每次读 live 容器，service 实例属性同步更新；启动期字段（dbPath/snapshotOrder/auditRetentionDays/retrieval.vector）在 settings 先于本插件挂载的常态下于开库前合成用户层，运行期变更写 `settings-reload-required` 审计行并要求重载——不做半热切换（store 不热重开、section order 注册期固定）。`enabled` 不进 namespace：false 时插件整体卸载、卡片随 namespace 消失，从 UI 上无法恢复。settings 缺失（headless）时 live 保持组合值，行为与未接入前一致。
- **设置卡片（零构建）**：`client/client.js` 同时注册第二个客户端模块 `dsh-memento/settings-card`（factory 经宿主模块系统 require 平台内置 react，无构建步骤），向 `settings.plugin.item` slot 注册键为 `dsh-memento` 的卡片。暂存—保存/放弃/单字段重置对齐宿主 CardForm 语义；写入按顶层字段聚合（`scope.set(top, 合并值)`），不依赖点路径写入面。悬浮窗开关经 `/api/memento/entries` 响应的 `panel` 字段贯通到面板启动探测——host 与面板同源，不依赖浏览器读 settings。

## 协议 v1（0.4.0：dsh-memory-protocol 社区预演）

### 13. 协议与实现分离：写语义抽进 lib/protocol.mjs（零 DSH 依赖）

0.4.0 把 MemoryService 的写语义整体抽进 `lib/protocol.mjs` 的 `MemoryProtocolCore`：预算预检 →
gate → 预算复审 → 落盘 → 审计的完整流水线、唯一子串定位、`<action>-denied` 审计行、协议级
校验（`validateMemoryEntry` / `validateExportEnvelope` / `validateAuditRow` / `normalizeTags`）。
`index.mjs` 的 `MemoryService` 变成薄子类，只注入两件 DSH 专属物：审批传输（ctx.approval）与
会话事件派发（memory/* 已知类型自适应门，见决策 4）。一致性套件的黄金参考 = 同一 core +
自动放行 gate——协议声称与实现同源，不存在"套件通过、实现另写一份"的漂移空间。协议常量
（`PROTOCOL_URI`、标签上限等）在 protocol.mjs；错误码语义进协议文档（docs/protocol-v1.md §7）。

### 14. store schema v4：条目 tags + version（协议 v1 条目规范）

- `tags`：JSON 数组列；协议常量上限 16 个 × 每标签 32 字符，trim/去重/禁控制字符，
  协议层 `normalizeTags` 校验（预算只计 text，tags 不计）。
- `version`：整数列，新条目 1；每次 `replace` 在 Provider 事务内 `version = version + 1`；
  consolidate/seed/导入产生全新 version 1 条目。审计链可经 entryId + 逐次审计行重建同一 id 的
  演进史。
- 迁移：SCHEMA_VERSION 3 → 4 走既有逐级迁移梯子（`V4_SCHEMA_SQL`），旧库无损升级；
  过新版本照旧响亮拒绝。

### 15. 适配器注册表（ctx.memoryAdapters）与一致性套件

- `lib/registry.mjs` 的 `MemoryAdapterRegistry`：`register`（返回 disposer，id 冲突响亮）/
  `list` / `adapt` / `export`；index.mjs 经 `ctx.effect` 注册三个参考适配器
  （`lib/adapters.mjs`：mem0 / hermes-memory-md / claude-code-memory-md），随插件生命周期可逆。
  适配器是纯数据转换器——只转换、绝不调模型抽取（载荷无事实条目时 `ADAPTER_PAYLOAD` 响亮失败）。
- 命令面：`/memory adapters`、`export --adapter=<id>`（只读 stdout 转换）、
  `import --adapter=<id> <路径|内联 JSON>`（转换 → `service.seed`：一次审批 + 全量预算预检 +
  单事务 + 逐条审计）。
- `test/protocol-conformance/`：可对外分发的用例集（suite/golden/run + Provider 契约 README），
  仓库 CI 以黄金参考全绿；第三方 Provider 拷贝目录即可跑同一套用例。协议文档：
  `docs/protocol-v1.md`（双语）、`docs/schemas/dsh-memory-protocol-v1.schema.json`、
  `docs/adapters-guide.md`（双语）、`docs/upstream-proposal.md`（双语，官方 seam 采纳论证与迁移路径）。

## P0：检索与嵌入 seam（可插拔检索 + 伪嵌入向量召回）

### 16. 检索 Provider seam（lib/retrieval.mjs）与嵌入 Provider seam（lib/embedding.mjs）

把 memory recall 的"检索"抽成可插拔检索器，并新增嵌入 Provider 接口，两者都是完整的
三角色 seam（Service Definition / Provider / Consumer），零 DSH 依赖、零重依赖：

- **检索 seam**（`ctx.memoryRetrieval`，`lib/retrieval.mjs`）：`RetrievalProvider` 契约 +
  `RetrievalProviderRegistry`（register 可逆 / list / get / resolve）。内置 `SubstringRetriever`
  是零依赖主路径（大小写不敏感子串 + 召回频次排序，语义与 `store.queryEntries` 的 instr 一致）；
  `VectorRetriever` 是可选后端，消费嵌入 provider 做内存内暴力余弦排序（小语料，与决策 10 一致）。
- **嵌入 seam**（`ctx.memoryEmbedding`，`lib/embedding.mjs`）：`EmbeddingProvider` 契约 +
  `EmbeddingProviderRegistry`。默认 `FakeEmbeddingProvider` 是确定性的 token 哈希分桶计数 +
  L2 归一化（固定 256 维单位向量）——它不做语义建模，只验证 seam 接线与余弦召回路径可复现；
  真实嵌入由可选 provider 注册（本地模型 / peer），本仓库不引入 sqlite-vec / ONNX / 本地模型。
- **Consumer 接线**：`Config.retrieval.vector`（默认 `false`）开启后，`memory_recall` 的记忆段改走
  vector 检索器（可见集 = `visibleEntries` + 检索器排序 + `store.bumpRecall` + `recalled` 审计）；
  默认仍走 `service.query` 的 substring 主路径，行为不变。
- **探测 → 使用 → 优雅降级**：`detectVectorBackend` 只要求 embedding provider 可用；sqlite-vec 是
  可选 loadable 扩展、恒不在本仓库打包（`sqliteVec: false`），P0 向量召回走内存内暴力余弦。
  缺 embedding / vector 关闭时优雅降级回 substring，绝不响亮失败（可选后端缺失不是配置错误）。
