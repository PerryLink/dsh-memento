# 上游化提案：把 dsh-memory-protocol v1 采纳为官方 `ctx.memory` seam

> English version: [upstream-proposal.md](upstream-proposal.md)。协议规范：
> [protocol-v1.zh.md](protocol-v1.zh.md)。

本文论证官方 DeepSeek Harness 的 `ctx.memory` seam 应采纳 **`dsh-memory-protocol/v1`**——
dsh-memento 正在社区预演的协议——并列出与官方 seam 的具体差异与迁移路径。面向 harness 维护者。

## 官方 seam 为什么应采纳本协议

**1. 审批门做在每条写路径的汇聚点——服务内部。**
官方 seam 目前没有记忆服务；记忆插件自带 store，而做在工具层的门可以被晚期工具注入绕过
（Hermes 在 [issue #48181](https://github.com/NousResearch/hermes-agent/issues/48181) 里记录的
失败模式）。协议钉死强制点：*每一条*写（`add`/`replace`/`remove`/`consolidate`/`seed`）都必须
经过 Provider 内部的审批传输；`writePolicy` 是模型看不见也改不了的配置；会话级 `never` 姿态
先于一切。

**2. 模型可见 ⟺ 可重建，按构造成立。**
审批载荷携带完整变更（approve-what-you-see：旧全文、新全文、整合逐目标摘录）；每条放行写落
审计行并标注真实裁决来源；每条被拒写在错误传播前落 `<action>-denied` 行。配合 harness 自己的
`approval/asked` + `approval/decided` 审计对，任何状态变化都能从会话日志重建——这正是 harness
对自己模型可见面已有的不变量。

**3. 本地优先：零网络、零凭据。**
参考 Provider 就是一个本地 SQLite 文件（`0600`，WAL），schema 版本单调递增、损坏/过新响亮失败
（`STORE_CORRUPT` / `STORE_UNSUPPORTED_VERSION`）。官方 seam 将把"记忆留在用户机器上"变成一等
性质，而不是每个插件的自我约束。

**4. 有界且诚实的预算。**
每轨每层硬字符预算 + 结构化 `BUDGET_EXCEEDED`（用量 + 上限 + 所需），给模型确定性的
"整合后重试"循环。不静默截断、不隐藏自动压缩——两者都是诱人而危险的黑魔法。

**5. 一套一致性套件管整个生态。**
`test/protocol-conformance/` 是可分发的用例集：任何声称兼容的 Provider 跑的与本仓库 CI 黄金
参考相同的用例。采纳协议让 20+ 记忆插件从"各自仓库"走向"一个协议、多种 store"——这是
Claude Code / Codex / OpenCode / Hermes 各自封闭记忆形态之间不存在的互操作点。

## 与当前官方 seam 的差异

| 方面 | 官方 seam 现状（rc.6） | dsh-memory-protocol v1 |
| --- | --- | --- |
| 记忆服务 | 无（官方立场是"记忆 = 外部 MCP"；插件自带） | 类型化 `ctx.memory` + 适配器注册表 `ctx.memoryAdapters` |
| 写审批门 | 各插件自定，通常在工具层 | 强制在 Provider 写方法内部；策略是模型不可见配置 |
| 条目模型 | 各插件自定 | 协议 v1：双轨 × 双层 × per-agent 键 + `tags` + 条目级 `version` |
| 预算 | 各插件自定 | 每轨每层硬字符预算 + 结构化错误 |
| 审计 | 各插件自定 | 审批审计对 + Provider 账本 + `<action>-denied` 行；重建有保证 |
| 互操作 | 无 | 一致性套件 + 参考适配器（mem0、Hermes memory.md、CLAUDE.md） |
| 会话事件 | — | `memory/added|updated|removed|recalled|snapshot` 词汇已声明合并；harness 收录类型后运行时自动开启派发 |

## 迁移路径

1. **采纳条目词汇**（轨道/作用域/agentKey）——dsh-memento 的 `types.d.ts` 声明合并可直接作为
   起点；对现有插件零行为变化。
2. **把 `memory/*` 会话事件类型注册进 `KNOWN_SESSION_EVENT_TYPES`**（或提供可标记
   `ignorable` 的 append 面）。参考实现已经按该集合自适应派发，切换前后没有数据或审计缺口。
3. **把 Provider 服务形状**（`budgets`/`add`/`replace`/`remove`/`query`/`seed`）定为官方
   Service Definition；协议核心（`lib/protocol.mjs`，零 DSH 依赖）结构上可以原样上提进 harness。
4. **把一致性套件采纳为生态门**：`dsh plugin verify` 可以对任何已装记忆插件跑同一套用例。

向后兼容：协议是对 dsh-memento 已发布的 0.3.x seam 的规范化与扩展——既有行为全保留；
`tags`/`version`/适配器都是增量。无论 harness 是否、何时采纳，参考实现都继续作为社区插件安装。
