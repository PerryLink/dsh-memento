# dsh-memento

**给 DeepSeek Harness 补上有界、分层、带审批门、可审计的跨会话记忆。**

[English](README.md) · [架构与设计决策](ARCHITECTURE.md)

别的记忆插件卖"仓库"，dsh-memento 卖**能力接缝**：类型安全的 `ctx.memory` 服务、模型绕不过去的写入审批门、能从会话日志重建的审计链。它是 DSH 的原生第一方记忆层——做的是**记忆协议 + 信任门 + 审计**，而不是又一个需要你伺候的存储仓库。

## 它提供什么

| 角色 | 组件 | 你得到什么 |
| --- | --- | --- |
| Service Definition | `ctx.memory`——`add` / `replace` / `remove` / `query` / `seed` / `budgets()` | 任何插件（例如未来的 dsh-claude-move 集成）通过**同一个门**读写**同一份** store |
| Provider | 本地 SQLite（`node:sqlite`，`$DSH_HOME/dsh-memento/memory.db`，WAL，0600） | 零依赖、零网络、零凭据 |
| Consumer | `memory` 工具 + 冻结快照注入（systemPrompt 段，顺序 `-50`） | 模型读写记忆；每个会话以带用量头的冻结快照开局 |

- **双轨 × 双层。** `user` 轨 = 用户画像（偏好、沟通风格、雷区）；`agent` 轨 = 环境事实、约定、教训。每轨分 `user-global`（跨工作区）与 `workspace`（按会话 cwd）两层——学 Codex 的合并分层，不学 Hermes 的纯全局。
- **每轨每层硬字符预算**（默认 user 2000 / agent 4000，中文友好计数：一个汉字 = 1 字符）。写满**必须报错**：返回结构化错误（含当前用量与上限），由模型整合/删除后重试。绝不截断、绝不自动压缩。
- **写入默认走审批（`writePolicy: 'ask'`）。** 审批门做在**服务方法内部**（审批 waterfall），不在工具层：任何工具、插件、间接路径想写记忆都必须过审批 seam。`'auto'` 放行但记录审批来源；`'off'` 拒绝。`writePolicy` 是 Config，模型不可见、不可改。
- **模型可见 ⟺ 落盘。** 每次写可从会话日志重建（`approval/asked` 携带完整载荷、`approval/decided` 记录结果）；注入的快照文本逐字进入 `request/header.system` 与插件 `audit` 表。
- **冻结快照。** 快照在会话首个 prompt 组装时渲染一次，会话内不再变化——前缀缓存天然稳定。会话内变更只落盘 + 落审计。

## 定位：为什么还要一个记忆插件？

| 插件 | 是什么 | dsh-memento 的差异 |
| --- | --- | --- |
| dsh-memory-evolve | 记忆仓库 / 演化循环 | memento 补的是类型化服务接缝、审批门与日志审计；不碰仓库野心 |
| dsh-mnemon | 记忆存储助手 | 同上——memento 是协议 + 门 + 审计，不是又一个 store |
| dsh-kb-sieve | 知识库筛选 | memento 不重造检索：小语料子串检索，跨会话回忆直接指引用内置 `session_search` |
| dsh-tdai-memory | 任务驱动记忆工具 | memento 的预算是 每轨×每层 硬约束且在服务层执行，不是尽力而为 |
| claude-bridge | Claude Code 桥接 | memento 是 DSH 原生；未来的 `seed(source:'claude')` 让桥接插件喂同一个 store |
| dsh-external/Recall | 外部 agent 记忆 | memento 本地优先、零网络，且走 DSH 自己的审批 seam |
| 官方 MCP 记忆示例（`examples/mcp-memory`） | 官方"记忆 = 外接 MCP"立场 | memento 是官方立场之外的**原生第一方**补充：目标一致、无需外部服务，两者可共存，互不取代 |

命名已定 **`dsh-memento`**（npm 与 GitHub 均空闲）。不用 `dsh-recall`（与 dsh-external/Recall 混淆），不用已删除的旧名 `dsh-memory`。

## 安装

要求 Node `^22.19 || >=24`、DSH `0.1.0-rc.6`（web profile）。无构建步骤——`index.mjs` + `lib/` 即发布产物。

```sh
# 本地 checkout（或 tarball / npm / GitHub 地址）
dsh plugin --profile <name> add ./dsh-memento
dsh --profile <name> --dump-config   # 应看到 "# == dsh-memento" 层，启动无 FAILED
```

卸载：

```sh
dsh plugin --profile <name> remove dsh-memento
```

卸载后记忆库与记录过记忆活动的会话日志**保留**，旧会话仍可正常加载。

## 配置

所有字段都是经过校验的 Config（Schemastery），可在 cordis.yml 的 `memento` 行覆盖。非法值加载期响亮失败。

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `enabled` | `true` | `false` 时服务/工具/快照/审批 answerer 整体消失（不留半残状态） |
| `dbPath` | `''` → `$DSH_HOME/dsh-memento/memory.db` | 绝对路径，或相对 `$DSH_HOME` |
| `budgets.user.userGlobal` / `budgets.user.workspace` | `2000` / `2000` | user 轨每层硬字符预算 |
| `budgets.agent.userGlobal` / `budgets.agent.workspace` | `4000` / `4000` | agent 轨每层硬字符预算 |
| `writePolicy` | `'ask'` | `'ask'`=用户审批；`'auto'`=放行但记录审批来源；`'off'`=拒绝。模型不可见 |
| `snapshotOrder` | `-50` | 快照段注入顺序：harness identity(`-100`) 之后、persona(`0`) 之前 |
| `maxEntriesPerQuery` | `20` | query 单次返回上限 |

示例（profile 的 `cordis.patch.yml`）：

```yaml
- insert:
    - id: memento
      name: dsh-memento
      config:
        writePolicy: auto
        budgets:
          user: { userGlobal: 4000, workspace: 2000 }   # 中文记忆多：调大预算并在 PR 说明理由
          agent: { userGlobal: 4000, workspace: 4000 }
```

## 使用

- 让模型"记住一件事" → 它调用 `memory` 工具 → （`ask` 策略下）用户审批 → `approval/asked` + `approval/decided` 落会话日志 → 条目落盘。
- 同一工作区的下一个会话以冻结快照开局（带用量头）。问"你记得我的哪些偏好？"——快照直接作答；跨会话回忆用内置 `session_search`（memento 不重复实现检索）。
- 超预算的写返回结构化错误（用量与上限），模型删除/整合条目后重试。
- 进入模型的一切都可自会话日志重建：`request/header.system`（快照文本）、`approval/asked`（完整写载荷）、`tool/call` + `tool/result`（规范结果），外加数据库里的 `audit` 表。

## 安全边界

- **只消费公开服务**（`tools`、`systemPrompt`、审批 seam）。不修改引擎 / agent-loop / apiproxy / 官方 UI 包。
- **零网络、零凭据。** 库在本地，POSIX 文件权限 0600。
- **失败大声。** 库损坏/版本过新加载期报错；写满与子串歧义报结构化错误。绝不静默吞、绝不静默截断。
- **单进程共库。** 单进程多会话共享 SQLite（串行写、每会话审计独立）。两个**进程**共用一个 `$DSH_HOME` 会写同一个库文件：SQLite 锁下"谁后写谁赢"，跨进程一致性不保证——不要对同一 `$DSH_HOME` 跑两个 harness 实例（与 Hermes 项目文档的官方警告一致）。
- **rc.6 会话事件说明。** `memory/added|updated|removed|recalled|snapshot` 事件词汇已在 types.d.ts 声明，但在 harness 收录这些事件类型之前不向会话日志 append（append 未注册类型会让持久化会话无法加载）。rc.6 上的审计完整性由审批审计对 + 审计表承担（见 [ARCHITECTURE.md](ARCHITECTURE.md) 决策 4）。

## 开发

```sh
npm install
npm test    # node --test：51 个测试——预算、唯一子串、审批策略、store、快照、mock ctx 集成（含 S2 可重建 / S3 不可绕过不变量）
```

`lib/` 零 DSH 依赖（仅 node: 内置模块）；DSH 依赖只出现在 `index.mjs`。完整纪律见 [AGENTS.md](AGENTS.md)。

## 许可证

MIT——见 [LICENSE](LICENSE)。不分发任何第三方代码；见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
