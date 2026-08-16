# dsh-memory-protocol v1

> 状态：**社区预演**——官方 `ctx.memory` seam 的候选形态。
> 规范性机器可读 Schema：[schemas/dsh-memory-protocol-v1.schema.json](schemas/dsh-memory-protocol-v1.schema.json)；
> 一致性套件：[`test/protocol-conformance/`](../test/protocol-conformance/README.md)。
> English version: [protocol-v1.md](protocol-v1.md)。

**`dsh-memory-protocol/v1`** 是 DeepSeek Harness 中有界、分层、带审批门、可审计的跨会话记忆
互操作协议。dsh-memento 是参考实现；任何其它记忆插件实现同一 Provider 面并通过同一套
一致性用例，即可声称协议兼容。

设计锚点（任何兼容 Provider 都不可妥协）：

- **审批门在服务内部，不在工具层。** 每条写路径（`add`/`replace`/`remove`/`consolidate`/`seed`）
  都被强制经过 Provider 内部的审批传输，任何模型路径都无法绕过（Hermes
  [issue #48181](https://github.com/NousResearch/hermes-agent/issues/48181) 的教训）。
- **模型可见 ⟺ 可重建。** 任何写入都必须能由审计证据重建：审批对（携带完整载荷的
  `approval/asked` + 携带结果的 `approval/decided`）+ Provider 自有审计账本。被拒写同样留痕。
- **本地优先。** 零网络、零凭据；存储是用户自有的本地文件。
- **有界且诚实。** 每轨每层硬字符预算；超预算写以结构化错误失败。绝不截断、绝不静默丢弃。

## 1. 协议标识与版本规则

| 字段 | 值 |
| --- | --- |
| 协议 id | `dsh-memory-protocol` |
| 版本 | `1`（URI 形：`dsh-memory-protocol/v1`） |
| 条目 schema 版本 | 按条目存储（`version`，从 1 起，每次 `replace` 自增） |
| 库 schema 版本 | 单调整数（参考实现 `SCHEMA_VERSION = 4`） |
| 导出信封 | `{plugin: "dsh-memento", schema: "memory-export-v1", …}` |

规则：

- 协议版本只在**契约**变化时提升（新必填字段、新错误语义）；纯增量的可选字段不提版本。
- 库 schema 逐级前向迁移；库版本高于 Provider 认知时**响亮拒绝**（`STORE_UNSUPPORTED_VERSION`）——
  绝不盲读、绝不静默降级。
- 条目自带 `version`，审计链可以不经文本比对重建同一 id 的演进史。

## 2. 条目模型

条目是协议的记忆单元：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `id` | string（UUID v4） | 跨会话稳定身份，由 Provider 生成 |
| `track` | `user` \| `agent` | `user` = 用户画像（偏好/风格/雷区）；`agent` = 环境事实/约定/教训 |
| `scope` | `user-global` \| `workspace` | `user-global` 对所有工作区生效；`workspace` 只对会话规范化 cwd 生效 |
| `workspaceKey` | string | `workspace` 条目的规范化绝对 cwd 键；`user-global` 为空串（Windows 大小写不敏感） |
| `agentKey` | string | 规范化 `agentPreset` 键；`''` = 所有 agent 可见的共享层 |
| `text` | string，非空 | 记忆内容；预算计数单位 = JS 字符串长度 |
| `source` | string | 来源标注（`dsh-memento`、`memory-tool`、`claude`、适配器 id…） |
| `tags` | string[] | 短标签：≤16 个、每个 ≤32 字符、trim、去重、无控制字符 |
| `version` | integer ≥ 1 | 从 1 起；`replace` 自增；`consolidate`/`seed`/导入产生全新 version 1 条目 |
| `createdAt` / `updatedAt` | integer（epoch ms） | `updatedAt >= createdAt` |
| `lastRecalled` | integer \| null | 最近一次 query 命中时间（epoch ms） |
| `recallCount` | integer ≥ 0 | query 命中次数（排序：高频即重要） |
| `sessionId` | string \| null | 最近一次写它的会话 id |

可见性：会话只能看到（`replace`/`remove`/`consolidate` 也只能改到）共享层（`agentKey === ''`）
+ 本 `agentPreset` 的条目，且 `workspace` 条目仅限本会话 cwd。管理面（命令、面板）与不带
会话上下文的 Provider 调用保持全量视图。

## 3. 写操作

所有写共享同一条流水线——**预算预检 → 审批传输 → 预算复审 → 原子落盘 → 审计行**——
任何一步失败都零部分写入。

| 操作 | 输入 | 语义 |
| --- | --- | --- |
| `add` | 条目输入 | 插入新条目（新 id、`version` 1）。不按值去重：重复文本合法；整合是调用方的工具。 |
| `replace` | 唯一子串 `match`、新 `text`、可选 `tags` | 按文本的大小写不敏感唯一子串定位并改写**恰好一条**。id 稳定；`version` 自增；给 `tags` 则更新，否则保留。 |
| `remove` | 唯一子串 `match` | 删除恰好一条。 |
| `consolidate` | 1..20 个 `matches`、新 `text`、可选 `tags` | 原子删除全部目标并插入一条新条目（`version` 1）——一次审批、一个事务。 |
| `seed` | 条目输入列表 | 一次审批批量插入；全有或全无（任一条超预算整批拒绝）；每条新 id、`version` 1。 |

**幂等与冲突裁决：**

- `replace`/`remove`/`consolidate` 是以唯一子串匹配为键的**条件写**：成功后重跑同一操作会以
  `ENTRY_NOT_FOUND` 失败（匹配已不存在），重试不可能造成双写。零命中 → `ENTRY_NOT_FOUND`；
  多命中 → `AMBIGUOUS_MATCH`（带候选数与文本样例）——调用方必须给更长、唯一的子串。
- 权威目标在**审批返回后重新解析**（审批等待期间并发写可能已改库）；最终预算复审与落盘之间
  无 `await`，不存在陈旧写窗口。
- `consolidate` 在单事务内解析全部目标：任何不匹配整体回滚。

**审批载荷（approve-what-you-see）：** 审批请求携带完整变更而非抽象动作：`add`/`seed` 带新文本；
`replace` 带 `from:`（旧条目全文）+ `to:`（新文本）；`remove` 带被删条目全文；`consolidate`
带每个目标的定位原文（单条 300 字摘录上限）+ 新文本。

## 4. 读操作

- `query(filter?, opts?)`——子串检索（ASCII 大小写不敏感折叠；对 CJK 正确）。无审批。
  选项：`track`/`scope`/`text`/`limit`（Provider 硬钳 1000）、`opts.sessionId`（落 `recalled`
  审计行）、`opts.agentKey`（会话可见集过滤）。
- `budgets()`——每轨每层用量报表（`{track, scope, used, limit}` 行）。
- 排序：命中 query 的条目 `recallCount + 1` 并更新 `lastRecalled`；结果按
  `recall_count DESC, updated_at DESC` 排序。

## 5. 预算模型

- 每轨每层硬字符预算（参考默认：user 2000 / agent 4000 每层）。预算只计 `text`——
  `tags` 与元数据不计入。
- 超预算写以 `BUDGET_EXCEEDED` 失败，携带 `{track, scope, used, limit, needed}`；
  调用方整合/删除后重试。**绝不截断、绝不自动压缩。**
- `seed` 先全量预检；任一条超预算整批拒绝，写任何内容之前即失败。

## 6. 审计与重建

- 每次放行写落一行审计：`{seq, ts, action, track, scope, entryId, text, outcome, source,
  sessionId}`。`outcome` 标注真实裁决来源（`allowed-once (via approval, writePolicy ask)` /
  `… (via write gate)`）。
- 每次被拒/取消/不可用的写在 `WRITE_DENIED` 错误传播前落 `<action>-denied` 行——turn 外
  gate 路径没有审批审计对，denied 行是那里的唯一证据链。
- 读召回落 `recalled` 行；注入快照落 `snapshot` 行（与模型所见逐字一致）。
- 配合审批对（`approval/asked` 完整载荷 + `approval/decided` 结果），任何状态变化都能从
  会话日志 + Provider 审计账本重建。

## 7. 错误码

结构化错误暴露稳定 `code`；工具与模型按 code 分支而非 message（message 刻意保持英文——
它们是跨语言的审计契约）。

| Code | 触发 | Details |
| --- | --- | --- |
| `INVALID_INPUT` | 非法 track/scope/text/tags/match/matches/信封 | — |
| `WRITE_REQUIRES_AGENT` | 写缺少 owning agent 会话 | — |
| `BUDGET_EXCEEDED` | 超预算写或 seed 批次 | `track, scope, used, limit, needed` |
| `ENTRY_NOT_FOUND` | 零命中匹配 | `track, scope, match` |
| `AMBIGUOUS_MATCH` | 多命中匹配 | `candidates`, `sample` |
| `WRITE_DENIED` | 审批 rejected/cancelled/unavailable | `outcome` |
| `PROPOSAL_NOT_FOUND` | 对非 pending 提案裁决 | `id` |
| `STORE_CORRUPT` / `STORE_UNSUPPORTED_VERSION` | 库不可读 / schema 过新 | `path` |
| `ADAPTER_NOT_FOUND` / `ADAPTER_PAYLOAD` | 未知适配器 id / 载荷不可转换 | `adapterId` |

## 8. 导入 / 导出信封

- `/memory export` 产出一份 JSON 文档
  `{plugin: "dsh-memento", schema: "memory-export-v1", exportedAt, budgets, entries}`——
  完整的备份/迁移往返。导出只读（无审批、不落审计）。
- `/memory import`（及 `import --adapter=<id>`）经 **`seed`** 恢复条目——一次审批、全量
  预算预检、单事务原子落盘、逐条审计。导入条目获得新 id/时间戳、`version` 1、召回计数归零；
  未知信封 schema 版本响亮拒绝；单次导入上限 1000 条。

## 9. 适配器注册表（`ctx.memoryAdapters`）

第三方记忆插件通过注册适配器（`register(adapter)` 返回 disposer——注册可逆，归属插件自己的
`ctx.effect`）把自己的 store 接进协议。适配器是纯数据转换器：`adapt(payload) → {entries}` 与
`export(entries) → payload`；绝不调用模型抽取。未知适配器 id 报 `ADAPTER_NOT_FOUND`；不可转换
载荷报 `ADAPTER_PAYLOAD`。dsh-memento 随附参考适配器：`mem0`、`hermes-memory-md`、
`claude-code-memory-md`。见 [adapters-guide.zh.md](adapters-guide.zh.md)。

## 10. 一致性

任何声称 `dsh-memory-protocol/v1` 兼容的 Provider 实现
[`test/protocol-conformance/README.md`](../test/protocol-conformance/README.md) 的 Provider 面，
并通过[一致性套件](../test/protocol-conformance/)——与本仓库 CI 中黄金参考（dsh-memento 自己的
Provider）跑的同一套用例。套件可对外分发（拷贝即跑，任意 Provider 工厂），自包含（仅
`node:assert`）。

## 11. 与官方 seam 的关系

协议是对 dsh-memento 现有 `ctx.memory` seam 的规范化与扩展——不是重写；0.3.x 的一切行为保持
兼容。协议在此之上的新增：条目级 `tags`/`version`、机器可读 JSON Schema、可分发的一致性套件、
适配器注册表。官方 seam 为何应采纳本协议及迁移路径，论证见
[upstream-proposal.zh.md](upstream-proposal.zh.md)。
