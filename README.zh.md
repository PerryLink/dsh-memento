# dsh-memento

**给 DeepSeek Harness 补上有界、分层、带审批门、可审计的跨会话记忆。**

[![license](https://img.shields.io/badge/license-Apache--2.0-3a7d44)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-0.1.0--rc.6-4e51e8)](https://www.npmjs.com/package/@deepseek-ai/dsh)
[![node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-339933)](https://nodejs.org/)
[![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)]()
[![no build step](https://img.shields.io/badge/build-none%20%28pure%20ESM%29-8a6d3b)]()
[![npm version](https://img.shields.io/npm/v/dsh-memento)](https://www.npmjs.com/package/dsh-memento)
[![npm downloads](https://img.shields.io/npm/dm/dsh-memento)](https://www.npmjs.com/package/dsh-memento)
[![CI](https://github.com/PerryLink/dsh-memento/actions/workflows/ci.yml/badge.svg)](https://github.com/PerryLink/dsh-memento/actions/workflows/ci.yml)

[English](README.md) · [中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

> 别的记忆插件卖**仓库**，dsh-memento 卖**接缝**：类型安全的 `ctx.memory` 服务、模型绕不过去的写入审批门、能从会话日志重建的审计链。DeepSeek Harness 的原生第一方记忆——记忆协议 + 信任门 + 审计，零网络、零凭据。

## ✨ 为什么是 dsh-memento？

- **它是能力接缝，不是又一个 store。** Service Definition（`ctx.memory`）+ 本地 SQLite Provider（`node:sqlite`，WAL，`0600`）+ Consumer（`memory` 工具 + 冻结快照注入）。任何未来的插件——dsh-claude-move 的 seed 集成、桥接、面板——都通过**同一个门**读写**同一份** store。
- **审批门不可绕过。** 每条写路径（`add`/`replace`/`remove`/`seed`）都被强制经过审批 waterfall，且强制点在**服务内部**而非工具层。`writePolicy: ask | auto | off` 是模型看不见、改不了的配置；会话级 `never` 姿态依旧先于一切。`replace`/`remove`/`consolidate` 的审批载荷携带将被改动的条目全文——批准什么就看到什么；被拒的写同样落 `*-denied` 审计行。
- **模型可见 ⟺ 落盘。** 注入的快照逐字进入 `request/header.system`；每次写都能从 `approval/asked`（完整载荷）+ `approval/decided`（结果）+ 插件自有审计表重建。
- **有界且诚实。** 每轨每层硬字符预算（默认 user 2000 / agent 4000）。写满**返回结构化错误**（用量 + 上限）——模型整合后重试。绝不截断、绝不自动压缩。

## ⚡ 30 秒上手

```sh
# 要求 Node ^22.19 || >=24、DSH 0.1.0-rc.6
dsh plugin --profile web add dsh-memento      # 或 ./dsh-memento / tarball / GitHub 地址
dsh --profile web --dump-config               # 应看到 "# == dsh-memento" 层，启动无 FAILED
```

然后在 Web UI 里：让模型记住一件事 → 批准这次写入 → 开一个**新会话**问它记得什么。演示到此结束。

```yaml
# 可选覆盖（写在 profile 的 cordis.patch.yml）
- id: memento
  config:
    writePolicy: ask        # ask（默认）| auto | off —— 模型不可见
    budgets:
      user: { userGlobal: 4000, workspace: 2000 }   # 中文记忆多：调大并在 PR 说明理由
      agent: { userGlobal: 4000, workspace: 4000 }
```

## 🧠 它提供什么

| | 组件 | 你得到什么 |
| --- | --- | --- |
| 🧩 Service Definition | `ctx.memory` —— `add` / `replace` / `remove` / `query` / `seed` / `budgets()` | 类型化、声明合并的服务；写方法内部强制过门 |
| 💾 Provider | `lib/store.mjs` —— `node:sqlite` 单文件（`$DSH_HOME/dsh-memento/memory.db`，WAL） | 零依赖、零网络；条目表 + 审计表；唯一子串匹配 |
| 🛠 Consumers | `memory` 工具 · 冻结快照注入（systemPrompt 段，顺序 `-50`）· `memory_recall` 工具 · `/memory` 命令 · 只读 Web 面板 | 模型读写、带用量头的冻结快照、两段式召回、用户侧命令、浏览器抽屉 |

**双轨 × 双层 × per-agent 键。** `user` 轨 = 用户画像（偏好、沟通风格、雷区）；`agent` 轨 = 环境事实、项目约定、教训。每轨分 `user-global`（跨工作区）与 `workspace`（按会话 cwd）两层——学 Codex 的合并分层，不学 Hermes 的纯全局。第三维按会话 `agentPreset` 隔离条目（per-agent 作用域）；无 preset 的条目留在人人可见的共享层。会话内读与写定位遵循同一可见集：会话只能看到（`replace`/`remove` 也只能改到）共享条目 + 本 agent 条目，`workspace` 条目仅限本会话 cwd；管理面（`/memory`、面板）保持跨 agent 全量视图。

**冻结快照。** 快照在会话首个 prompt 组装时渲染一次（SQLite 同步读 + 按会话缓存），会话内不再变化——前缀缓存天然稳定。会话内变更只落盘 + 落审计。

```
Consumer: memory 工具           Consumer: 冻结快照（systemPrompt 段，顺序 -50）
   add/replace/remove/query        按会话冻结，带用量头
        │ 写（agent+callId）         │ 读（同步，session cwd）
        ▼                           ▼
Service Definition: ctx.memory —— budgets/add/replace/remove/query/seed
   每次写：预算预检 → ctx.approval.request（审批 waterfall）→ 预算复审 → 落盘 → 审计
        │
        ▼
Provider: lib/store.mjs —— node:sqlite（WAL，0600），条目表+审计表，唯一子串匹配
```

## 🧰 安装与卸载

```sh
dsh plugin --profile <name> add ./dsh-memento        # 本地 checkout（无构建步骤）
dsh plugin --profile <name> add dsh-memento          # npm 包（0.2.0 起已发布）
dsh plugin --profile <name> add git+https://github.com/PerryLink/dsh-memento.git   # GitHub 安装
dsh plugin --profile <name> remove dsh-memento       # 卸载：库与会话日志保留
```

卸载后记忆库与记录过记忆活动的会话日志保留，旧会话仍可正常加载。

## ⚙️ 配置

所有字段都是经过校验的 Schemastery `Config`；非法值加载期响亮失败。在 cordis.yml 的 `memento` 行覆盖。

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `enabled` | `true` | `false` 时服务/工具/快照/命令/面板/answerer 整体消失（不留半残状态） |
| `dbPath` | `''` → `$DSH_HOME/dsh-memento/memory.db` | 绝对路径，或相对 `$DSH_HOME`；`$DSH_HOME` 未导出时（Windows 默认——`dsh web` 不会把解析出的主目录写回环境变量）两者都回退 `~/.dsh` |
| `budgets.user.userGlobal` / `budgets.user.workspace` | `2000` / `2000` | user 轨每层硬字符预算 |
| `budgets.agent.userGlobal` / `budgets.agent.workspace` | `4000` / `4000` | agent 轨每层硬字符预算 |
| `writePolicy` | `'ask'` | `'ask'`=用户审批；`'auto'`=放行但记录审批来源；`'off'`=拒绝。模型不可见 |
| `writePolicies` | `{}` | 按 track/scope 或来源覆盖：键 `user/workspace`、`agent/user-global`、`source:claude` 等 → `ask`/`auto`/`off`；未命中回退 `writePolicy` |
| `language` | `'en'` | 模型可见文案与命令输出语言：`'en'`（默认）或 `'zh'`——工具描述、冻结快照、`/memory` 命令、Web 面板全部跟随 |
| `snapshotOrder` | `-50` | 快照段注入顺序：harness identity(`-100`) 之后、persona(`0`) 之前 |
| `maxEntriesPerQuery` | `20` | query 默认返回上限（显式 `limit` 可超出，硬钳 1000） |
| `commandListLimit` | `50` | `/memory list`/`query` 命令单次渲染条目上限 |
| `commandAuditLimit` | `10` | `/memory audit` 命令单次渲染审计行上限 |
| `recall.historyLimitDefault` / `recall.snippetCap` / `recall.snippetChars` / `recall.windowDays` | `8` / `5` / `300` / `30` | `memory_recall` 历史段默认值：扫描会话数 / 每会话片段数 / 片段字符数 / 回溯天数 |
| `panelEntriesLimit` | `200` | Web 面板条目页大小（兼钳制上限） |
| `panelAuditLimit` | `20` | Web 面板审计默认条数（天花板 200） |
| `auditRetentionDays` | `0` | 审计保留天数：0 = 永久，>0 = 打开库时裁剪更早的审计行 |
| `proposals.enabled` / `proposals.maxChars` / `proposals.maxPending` | `true` / `2000` / `8` | auto-capture：每次压缩成功后生成待审批记忆提案（截断、每会话一条）；可关闭或调上限 |

## 🛠 工具与观察面

- **`memory`** —— add/replace/remove/consolidate/query，工具描述内嵌 Save/Skip 行为指引（存用户偏好、纠正、环境事实、项目约定、教训；跳过琐碎事实、可再查的百科知识、大数据转储、一次性路径）。写走审批门，读免费；replace/remove 用**唯一子串**定位（歧义时报候选清单）；consolidate 一次审批 + 一次原子写把 1..20 条整合为一条。
- **`memory_recall`** —— 两段式召回：有界记忆匹配 **+** 经 `ctx.sessionQuery` 的近期会话历史匹配（服务缺失时优雅降级为纯记忆结果）。
- **`/memory`** —— 用户触发命令（非模型回合）：`list` · `query <词>` · `add [--track=user|agent] [--scope=user-global|workspace] <文本>` · `remove [选项] <子串>` · `consolidate [选项] <子串...> => <新文本>` · `proposals [approve|dismiss <id>]` · `budgets` · `audit` · `export` · `import <路径>`。命令写走同一 waterfall 与策略；审计落插件审计表 + `command/done`。`export` 只读，把所有条目 + 预算导出为一份 JSON 文档；`import` 把它恢复回来（文件路径或内联 JSON，单次审批、预算预检）——备份/迁移完整闭环。导入条目获得新 id 与新时间戳；提案、审计行与召回计数不迁移。
- **Auto-capture 提案** —— 会话压缩成功后，摘要落为待审批记忆提案（`agent/workspace`）；approve 经审批门写入记忆，dismiss 丢弃。待审批提案出现在冻结快照与面板中。
- **Web 面板** —— 零构建 `dsh.client` 抽屉：按轨/层浏览条目、搜索、预算用量条、审计尾。设计上只读：写与审批走 `memory` 工具与内置审批 UI。

## 🎓 向终端记忆们学到的优点

dsh-memento 不是 Claude Code、Codex 或 Hermes 的移植版——但它的设计刻意吸收了这三家各自做对的部分，也刻意拒绝了它们吃过的亏：

| 终端记忆 | 做对了什么 | dsh-memento 吸收了 |
| --- | --- | --- |
| **Claude Code** —— `CLAUDE.md` | 分层**纯文本记忆文件**（用户级 → 项目级），人可读、人可改，每个会话自动合并——你能自己读、自己修的记忆 | 纯文本条目；每会话合并 `user-global` / `workspace` 层；可浏览、可 `export`、可审计的库——透明即特性 |
| **Codex** —— `AGENTS.md` | **按目录作用域的指令**自动发现、零摩擦注入——就近比堆量更重要，加载记忆无需任何工具调用 | `workspace` 层按会话 cwd 隔离（Windows 大小写不敏感）；冻结快照会话启动时自动注入 |
| **Hermes** —— `memory.md` | **主动记忆保存**（存/改/删），以及 [issue #48181](https://github.com/NousResearch/hermes-agent/issues/48181) 的安全教训：只做在工具层的门会被迟到的工具注入绕过——应把门做在所有写路径的交汇处 | 内嵌 Save/Skip 指引的 `memory` 工具 + 走审批门的 auto-capture 提案；审批门做在 **`ctx.memory` 写方法内部**，不在工具层 |

出处：[Claude Code 记忆](https://code.claude.com/docs/en/memory) · [Codex AGENTS.md](https://developers.openai.com/codex/cli/agents-md) · [Hermes 记忆](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md) · [Hermes #48181](https://github.com/NousResearch/hermes-agent/issues/48181)。

刻意拒绝的部分：把自动摘要写进模型私有状态的隐藏记忆（本插件把压缩摘要变成**待审批提案**，等人 approve/dismiss）、仓库/向量库野心、以及任何缺少人可见审批或审计痕迹的写入。同时采纳 Hermes 文档的警告：两个进程共用一个 home 目录会写同一份记忆文件——见安全边界。

## 🆚 与其它记忆插件的差异

| 插件 | 是什么 | dsh-memento 的差异 |
| --- | --- | --- |
| dsh-memory-evolve | 记忆仓库 / 演化循环 | 类型化服务接缝、审批门、会话日志审计；不碰仓库野心 |
| dsh-mnemon | 记忆存储助手 | 协议 + 门 + 审计，不是又一个 store |
| dsh-kb-sieve | 知识库筛选 | 不重造检索：小语料子串检索，跨会话回忆用 `session_search`/`sessionQuery` |
| dsh-tdai-memory | 任务驱动记忆工具 | 预算是每轨×每层硬约束且在服务层执行，不是尽力而为 |
| claude-bridge | Claude Code 桥接 | DSH 原生；未来的 `seed(source:'claude')` 让桥接插件喂同一个 store |
| dsh-external/Recall | 外部 agent 记忆 | 本地优先、零网络，走 DSH 自己的审批 seam |
| 官方 MCP 记忆示例 | 官方"记忆 = 外接 MCP"立场 | **原生第一方**补充：目标一致、无需外部服务，两者可共存 |

命名已定 **`dsh-memento`**（npm 与 GitHub 均已发布）。不用 `dsh-recall`（与 dsh-external/Recall 混淆），不用已删除的旧名 `dsh-memory`。

## 🔒 安全边界

- **只消费公开服务**（`tools`、`systemPrompt`、审批 seam）。不修改引擎 / agent-loop / apiproxy / 官方 UI 包。
- **零网络、零凭据。** 库在本地，POSIX 文件权限 `0600`。
- **失败大声。** 库损坏/版本过新加载期报错；写满与子串歧义报结构化错误。绝不静默吞、绝不静默截断。
- **单进程共库。** 单进程多会话共享 SQLite（串行写、每会话审计独立）。两个**进程**共用一个 `$DSH_HOME` 会写同一个库文件：SQLite 锁下"谁后写谁赢"——不要对同一 `$DSH_HOME` 跑两个 harness 实例（与 Hermes 项目文档的官方警告一致）。

## ⚠️ 已知局限

- **会话事件词汇已声明、rc.6 上暂不派发。** `memory/added|updated|removed|recalled|snapshot` 已在 `types.d.ts` 声明合并，但 rc.6 没有仓外插件事件类型的注册面（append 未注册类型会让持久化会话无法加载）。审计完整性由审批审计对 + 审计表承担；harness 收录这些类型后自动开启派发。见 [ARCHITECTURE.md](ARCHITECTURE.md) 决策 4。
- **`ask` 策略需要 answerer。** 没有 UI/ACP answerer 组合时写失败封闭（`unavailable`）——这是审批 seam 的失败封闭姿态，属设计行为。
- **不使用 FTS5 索引。** 子串检索走大小写不敏感 `instr`（对 CJK 正确）；召回排序用逐条目命中计数。FTS5 的 trigram 分词器无法索引单字 CJK 字符，故不采用——见 [ARCHITECTURE.md](ARCHITECTURE.md) 决策 10。

## 🧪 开发

```sh
npm install
npm test                # node --test：115 个测试——预算、唯一子串、审批策略、store、快照、mock ctx 集成（S2/S3 不变量）、V2 命令/召回/面板/导入
npm run typecheck       # tsc --checkJs 类型检查门（index.mjs / lib / scripts）
npm run check:coverage  # 行覆盖率门：lib ≥90%、index.mjs ≥85%、全部 ≥90%
npm run check:readmes   # 五语 README 一致性门
```

`lib/` 零 DSH 依赖（仅 node: 内置模块）；DSH 依赖只出现在 `index.mjs`。完整纪律见 [AGENTS.md](AGENTS.md)；设计决策见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 🏷 话题

建议的 GitHub topics：`dsh` · `dsh-plugin` · `deepseek-harness` · `memory` · `agent-memory` · `approval` · `audit` · `sqlite` · `cordis` · `llm`

## 👥 贡献者

特别感谢 [@Niuniu-Sir](https://github.com/Niuniu-Sir) 的 issue [#1](https://github.com/PerryLink/dsh-memento/issues/1)——这份详尽的启动崩溃报告促成了 0.3.1 中 `~/.dsh` 回退的落地。

## 📄 许可证

Apache License 2.0——见 [LICENSE](LICENSE)。不分发任何第三方代码；见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
