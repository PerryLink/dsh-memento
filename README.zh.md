<div align="center">

# dsh-memento
- **1024 商店渠道**：先 `npm i -g dsh1024`，再 `dsh1024 plugin --profile web add dsh-memento`（计入 [deepseek1024.com](https://deepseek1024.com) 安装排行）。

**给 DeepSeek Harness 补上有界、分层、带审批门、可审计的跨会话记忆。**

*一个类型安全的 `ctx.memory` 接缝、模型绕不过去的写入审批门，以及能从会话日志重建的审计链。*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh-plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-memento/ci.yml?branch=main&label=CI)](https://github.com/PerryLink/dsh-memento/actions)
[![Version](https://img.shields.io/github/v/tag/PerryLink/dsh-memento?label=version)](https://github.com/PerryLink/dsh-memento/releases)
[![npm version](https://img.shields.io/npm/v/dsh-memento)](https://www.npmjs.com/package/dsh-memento)
[![npm downloads](https://img.shields.io/npm/dm/dsh-memento)](https://www.npmjs.com/package/dsh-memento)

[English](README.md) · [简体中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

</div>

---

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `0.1.1-rc.2` |
| Node | `^22.19.0 || >=24.0.0` |
| Platforms | Windows / macOS / Linux（纯 host；无原生代码、无网络） |
| Model | 任意 |

## What you get

`dsh-memento` 是能力接缝，不是又一个仓库：一个类型安全的 `ctx.memory` 服务、一个本地 SQLite 提供方（`node:sqlite`，WAL，`0600`，位于 `$DSH_HOME/dsh-memento/memory.db`），以及它的消费方——`memory` 工具与注入系统提示的冻结快照。

- **审批门不可绕过。** 每条写路径（`add` / `replace` / `remove` / `seed`）都被强制经过服务内部的审批 waterfall，而非工具层。`writePolicy: ask | auto | off` 是模型看不见的配置；`replace` / `remove` / `consolidate` 的审批载荷携带将被改动条目的全文，被拒的写同样落一条 `*-denied` 审计行。
- **模型可见 ⟺ 已记录。** 注入的快照逐字进入 `request/header.system`；每次写都能从 `approval/asked` + `approval/decided` + 插件自有审计表重建。
- **有界且诚实。** 每轨每层硬字符预算（默认 user 2000 / agent 4000）。写满返回结构化错误（用量 + 上限）——绝不截断、绝不自动压缩。

两条轨道 × 两个层级 × 按 agent 隔离：`user` 轨（关于用户的事实）与 `agent` 轨（环境事实与约定），各自再分为 `user-global` 与 `workspace` 层，并按 `agentPreset` 隔离。快照在会话首次组装提示时冻结一次，会话中途不再变化。

## Quick start

```sh
# 1. install the bundle into your profile
dsh plugin --profile web add "github:PerryLink/dsh-memento#main"

# or from npm (published releases)
dsh plugin --profile web add dsh-memento

# 2. restart and verify the row
dsh --profile web --dump-config | grep -A3 'id: memento'
```

## Install & uninstall

- **git channel**（最新 `main`）：`dsh plugin --profile web add git+https://github.com/PerryLink/dsh-memento.git`。
- **npm channel**（发布版本）：`dsh plugin --profile web add dsh-memento`。
- **tarball channel**：在本仓库执行 `npm pack`，然后 `dsh plugin --profile web add ./dsh-memento-<version>.tgz`。
- **uninstall**：`dsh plugin --profile web remove dsh-memento`（记忆库与会话日志保留）。

## Configuration

所有可调项均为 Schemastery `Config` 字段（可在 cordis.yml 中修改）。非法值在加载期响亮失败。在 `memento` 行下覆盖。

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | 总开关；`false` 移除服务、工具、快照、命令、面板与 answerer |
| `dbPath` | `''` → `$DSH_HOME/dsh-memento/memory.db` | 绝对路径，或相对 `$DSH_HOME`（Windows 上回退到 `~/.dsh`） |
| `budgets.user.userGlobal` | `2000` | user 轨 user-global 层的硬字符预算 |
| `budgets.user.workspace` | `2000` | user 轨 workspace 层的硬字符预算 |
| `budgets.agent.userGlobal` | `4000` | agent 轨 user-global 层的硬字符预算 |
| `budgets.agent.workspace` | `4000` | agent 轨 workspace 层的硬字符预算 |
| `writePolicy` | `'ask'` | 默认写策略：`ask` / `auto` / `off`（模型不可见） |
| `writePolicies` | `{}` | 按轨/作用域或按来源的覆盖（如 `user/workspace`、`source:claude`） |
| `language` | `'en'` | 模型可见文本与命令输出语言：`en` / `zh` |
| `snapshotOrder` | `-50` | 快照段顺序（在 harness 身份之后、persona 之前） |
| `maxEntriesPerQuery` | `20` | 每次查询默认结果上限（硬上限 1000） |
| `commandListLimit` | `50` | 每次 `/memory list` / `query` 渲染的条目数 |
| `commandAuditLimit` | `10` | 每次 `/memory audit` 渲染的审计行数 |
| `recall.historyLimitDefault` | `8` | `memory_recall` 默认扫描的会话数 |
| `recall.snippetCap` | `5` | `memory_recall` 每个会话的片段数 |
| `recall.snippetChars` | `300` | `memory_recall` 片段字符数 |
| `recall.windowDays` | `30` | `memory_recall` 近期窗口天数 |
| `retrieval.vector` | `false` | 语义召回开关：`true` 且探测到嵌入 provider 时 `memory_recall` 走向量召回（伪嵌入），否则优雅降级回 substring |
| `panelEntriesLimit` | `200` | Web 面板条目分页大小 |
| `panelAuditLimit` | `20` | Web 面板默认审计行数 |
| `auditRetentionDays` | `0` | 审计保留天数（0 = 永久保留） |
| `proposals.enabled` | `true` | 每次成功压缩后自动捕获一条记忆提案 |
| `proposals.maxChars` | `2000` | 提案字符上限 |
| `proposals.maxPending` | `8` | 待处理提案上限 |

## Tools & surfaces

| Surface | Kind | Notes |
|---|---|---|
| `memory` | tool | 带 Save/Skip 指引的 add/replace/remove/consolidate/query；写入走审批门 |
| `memory_recall` | tool | 有界的记忆匹配 + 近期会话历史匹配 |
| `/memory` | command | `list` · `query` · `add` · `remove` · `consolidate` · `proposals` · `budgets` · `audit` · `export` · `import <path>` · `adapters` |
| web panel | client drawer | 只读：浏览条目、搜索、预算条、审计尾部 |

## MCP server

`dsh-memento` 附带一个只读 stdio **MCP 服务器**（`dsh-memento-mcp`），让外部 MCP 客户端（Claude、Codex 等）无需 harness 即可检索记忆库。它通过 newline-delimited JSON（NDJSON）承载 JSON-RPC 2.0——每行一个 JSON 对象，不支持 `Content-Length` 分帧。

**只读。** 数据库以 `node:sqlite` 的 `readOnly: true` 打开（不跑迁移、不写 WAL、不 bump recall-count）；库文件不存在时返回空结果而非崩溃。

| 工具 | 用途 |
|---|---|
| `memory_search` | `{query, limit?}` → 排序后的条目（经检索 Provider seam 的大小写不敏感子串检索） |
| `memory_stats` | `{}` → `{total, namespaces}` 条目总数 + 按轨道/作用域概览 |

直接运行：

```sh
node bin/mcp-server.mjs
# 或 npm 安装后：npx dsh-memento-mcp
```

数据库路径取自 `$DSH_MEMENTO_DB_PATH`（绝对路径，或相对 `$DSH_HOME`）；默认为 `$DSH_HOME/dsh-memento/memory.db`。

Claude Desktop（`claude_desktop_config.json`）配置示例：

```json
{
  "mcpServers": {
    "dsh-memento": {
      "command": "npx",
      "args": ["-y", "dsh-memento-mcp"],
      "env": {
        "DSH_MEMENTO_DB_PATH": "/home/you/.dsh/dsh-memento/memory.db"
      }
    }
  }
}
```

服务器只读：无网络、无写入、无审批门——仅检索与统计。

## How it's different

| Plugin | 是什么 | dsh-memento 的差异 |
|---|---|---|
| dsh-memory-evolve | 记忆仓库 / 进化循环 | 类型化服务接缝、审批门与会话日志审计；无仓库野心 |
| dsh-mnemon | 记忆存储助手 | 协议 + 门 + 审计，而非又一个 store |
| dsh-kb-sieve | 知识库筛选 | 无检索工程：小语料子串搜索，经 `session_search`/`sessionQuery` 跨会话召回 |
| dsh-tdai-memory | 任务驱动记忆工具 | 预算按 track×layer 且在服务内强制执行，而非尽力而为 |
| claude-bridge | Claude Code 桥接 | DSH 原生；未来的 `seed(source:'claude')` 路径让桥接写入同一 store |
| dsh-external/Recall | 外部 agent 记忆 | 本地优先、零网络、走 DSH 自有审批接缝 |
| Official MCP memory examples | DSH 宣称的"memory = 外部 MCP"立场 | **原生第一方**补充：同目标、无外部服务器；两者共存 |

名称是 **`dsh-memento`**（已发布到 npm 与 GitHub）。不是 `dsh-recall`（易与 dsh-external/Recall 混淆），也不是已删除的旧名 `dsh-memory`。

## dsh-memory-protocol v1

`dsh-memento` 是 DSH 记忆协议的社区预演——官方 `ctx.memory` 接缝的一个候选形态。该协议把本插件的接缝规范化为跨插件契约：

- **Entry spec** — 两条轨道 × 两个层级 × 按 agent 隔离，外加短 `tags`（≤16 × ≤32 字符）与每次 `replace` 递增的每条目 `version`。
- **Write semantics** — 幂等的唯一子串条件写；批准即所见载荷（`replace` / `remove` / `consolidate` 携带将被改动的全文）。
- **Audit contract** — 每次写都能从 `approval/asked` + `approval/decided` + 提供方账本重建。
- **Budget model** — `BUDGET_EXCEEDED` / `AMBIGUOUS_MATCH` 语义。
- **Schema versioning** — 带响亮版本检查的迁移规则。

- **Spec** — [docs/protocol-v1.md](docs/protocol-v1.md)（中文: [protocol-v1.zh.md](docs/protocol-v1.zh.md)）；规范性 JSON Schema 见 [docs/schemas/dsh-memory-protocol-v1.schema.json](docs/schemas/dsh-memory-protocol-v1.schema.json)。

**Adapter registry** — `ctx.memoryAdapters`（`register` / `list` / `adapt` / `export`）让第三方记忆插件通过注册纯数据转换器接入协议（可逆 `register()`；导入走审批门 `seed`，导出只读）。接入指南：[docs/adapters-guide.md](docs/adapters-guide.md)（中文: [adapters-guide.zh.md](docs/adapters-guide.zh.md)）。

| Built-in adapter | External format | Notes |
|---|---|---|
| `mem0` | mem0 fact collections（`{facts: [{memory, metadata?}]}`） | `metadata.category` / `metadata.tags` 成为 tags；原始 `messages` 数组被拒绝——适配器只转换、绝不抽取 |
| `hermes-memory-md` | Hermes `memory.md`（`## section` + 列表项） | 章节名成为 tags；非列表散文响亮失败 |
| `claude-code-memory-md` | `CLAUDE.md` 风格 markdown（标题、列表、段落） | 列表项与段落成为条目；章节名成为 tags |

**Conformance suite** — [test/protocol-conformance/](test/protocol-conformance/README.md)：可分发用例集，任何声明兼容的提供方都能跑（`node test/protocol-conformance/run.mjs --provider ./your-factory.mjs`）；本仓库 CI 以自有提供方为黄金参考运行它（`npm run test:conformance`）。

- **Upstream proposal** — [docs/upstream-proposal.md](docs/upstream-proposal.md)（中文: [upstream-proposal.zh.md](docs/upstream-proposal.zh.md)）：为何官方 `ctx.memory` 接缝应采纳该协议、差异与迁移路径。

## Permissions & data

- **Permissions**：workshop 清单声明 `harness:tool`、`filesystem:read`、`filesystem:write`，以及 `network:none` / `subprocess:none` / `shell:none` / `python:none` / `credentials:none`。写审批走官方审批接缝。
- **Data**：本地 SQLite 数据库（`0600`），零网络、零凭据。
- **Session log**：审计完整性来自审批对（`approval/asked` + `approval/decided`）加插件自有审计表。

## Security boundaries

- **仅公开服务。** 只消费 `tools`、`systemPrompt` 与审批接缝；不改 engine / agent-loop / apiproxy / 官方 UI。
- **零网络、零凭据。** 本地数据库，POSIX 文件权限 `0600`。
- **失败要大声。** 库损坏、schema 过新或非法配置在加载期抛错；写满与子串歧义返回结构化错误。
- **一进程一库。** 多个会话共享 SQLite 库；共享同一 `$DSH_HOME` 的两个进程写同一文件（SQLite 锁下后写覆盖）。

## Known limitations

- **会话事件已声明、尚未发出（rc.2）。** `memory/added|updated|removed|recalled|snapshot` 已合并声明，但 rc.2 没有仓库外事件类型的注册面；一旦 harness 构建收录这些类型即自动开启发出。
- **`ask` 策略需要 answerer。** 未组合 UI/ACP answerer 时，写入失败关闭。
- **无 FTS5 索引。** 子串搜索走大小写不敏感的 `instr`（对 CJK 正确）。

## What we learned from the terminal memories

`dsh-memento` 不是 Claude Code、Codex 或 Hermes 的移植——但其设计刻意吸收了它们各自做对的部分，并拒绝有害的部分：

| Terminal memory | 做对了什么 | dsh-memento 采纳了什么 |
|---|---|---|
| **Claude Code** — `CLAUDE.md` | 分层纯文本记忆文件（用户级 → 项目级），人类可读、可编辑，自动合并进每个会话 | 纯文本条目；`user-global` / `workspace` 层按会话合并；可浏览、`export`、审计的 store——透明即特性 |
| **Codex** — `AGENTS.md` | 按目录作用域自动发现并注入的指令，零模型摩擦 | 按会话 cwd 隔离的 `workspace` 层（Windows 大小写不敏感）；会话开始时自动注入冻结快照 |
| **Hermes** — `memory.md` | 主动记忆保存，以及"只在工具层强制门可被后期工具注入绕过"的安全教训 | 带 Save/Skip 指引的 `memory` 工具 + 审批门控的自动捕获提案；门位于 `ctx.memory` 写方法内部，而非工具层 |

来源：[Claude Code memory](https://code.claude.com/docs/en/memory) · [Codex AGENTS.md](https://developers.openai.com/codex/cli/agents-md) · [Hermes memory](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md) · [Hermes #48181](https://github.com/NousResearch/hermes-agent/issues/48181)。

刻意拒绝的部分：隐藏地自动摘要进模型私有状态（此处压缩摘要成为等待人类 approve/dismiss 的**待处理提案**）、仓库/向量库野心，以及任何缺少人类可见审批或审计链的写入。也采纳了：Hermes 记载的"两个进程共享一个主目录写同一记忆文件"的告诫——见 Security boundaries。

## Development

```sh
npm install              # node ^22.19 || >=24
npm test                 # node --test: 141 tests
npm run lint             # oxlint
npm run test:conformance # dsh-memory-protocol v1 conformance suite
npm run typecheck        # tsc --checkJs gate
npm run check:coverage   # line-coverage gate
npm run check:readmes    # five-language README consistency gate
npm run verify:self-contained # reject out-of-repo dependency specs
npm run verify:artifacts # artifact presence + syntax + import
```

`lib/` 零 DSH 依赖（仅 node: 内置模块）；DSH 导入只出现在 `index.mjs`。

## Topics

`dsh`, `dsh-plugin`, `deepseek-harness`, `memory`, `agent-memory`, `approval`, `audit`, `sqlite`, `cordis`, `llm`

## Contributors

- [@Niuniu-Sir](https://github.com/Niuniu-Sir) — [issue #1](https://github.com/PerryLink/dsh-memento/issues/1) 中的启动崩溃报告，催生了 0.3.1 引入的 `~/.dsh` 回退。

## PerryLink DSH Plugin Family

这是 [PerryLink](https://github.com/PerryLink) 维护的 [33 个 DeepSeek Harness 插件](https://github.com/PerryLink) 之一。如果它能帮到你，其他的也会：

| Plugin | One-liner |
|---|---|
| **[dsh-dsh-auto-review](https://github.com/PerryLink/dsh-dsh-auto-review)** | 审批链上的第二模型自动审查，默认失败关闭 | |
| **[dsh-dsh-background-agents](https://github.com/PerryLink/dsh-dsh-background-agents)** | 带 Web UI 侧栏、消息与中断的持久后台子代理 | |
| **[dsh-dsh-budget](https://github.com/PerryLink/dsh-dsh-budget)** | DeepSeek Harness 的成本治理：预算、碳排与延迟一屏呈现。 | |
| **[dsh-dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-dsh-checkpoint-rewind)** | Claude Code /rewind 等价：快照、会话 fork、一次性恢复 | |
| **[dsh-dsh-claude-move](https://github.com/PerryLink/dsh-dsh-claude-move)** | 把 Claude Code 会话、记忆、技能与 CLAUDE.md 迁入 DSH | |
| **[dsh-dsh-click](https://github.com/PerryLink/dsh-dsh-click)** | 跨平台原生桌面控制（DeepSeek Harness），Windows 优先。 | |
| **[dsh-dsh-composer-history](https://github.com/PerryLink/dsh-dsh-composer-history)** | Web 输入框的终端式历史：方向键、Ctrl+R 搜索 | |
| **[dsh-dsh-data-quality](https://github.com/PerryLink/dsh-dsh-data-quality)** | 数据集质量检查与引文核查（本插件可选消费的数字核查桥） | |
| **[dsh-dsh-defend](https://github.com/PerryLink/dsh-dsh-defend)** | DeepSeek Harness 的提示注入、越狱与密钥泄露防护。 | |
| **[dsh-dsh-doublecheck](https://github.com/PerryLink/dsh-dsh-doublecheck)** | 工程纪律守卫：需求质询、测试门禁、对手评审 | |
| **[dsh-dsh-draw](https://github.com/PerryLink/dsh-dsh-draw)** | DeepSeek Harness 的统一静态图像生成路由。 | |
| **[dsh-dsh-fast](https://github.com/PerryLink/dsh-dsh-fast)** | DeepSeek Harness 只读性能诊断。 | |
| **[dsh-dsh-fund-research](https://github.com/PerryLink/dsh-dsh-fund-research)** | 面向中国公募基金的确定性研究报告 | |
| **[dsh-dsh-github](https://github.com/PerryLink/dsh-dsh-github)** | 面向 DSH 的 GitHub PR/issues 集成，每次写入经审批门控 | |
| **[dsh-dsh-industry-research](https://github.com/PerryLink/dsh-dsh-industry-research)** | 行业研究编排，经本插件的 `ctx.researchReport.assemble` 封存交付物 | |
| **[dsh-dsh-library](https://github.com/PerryLink/dsh-dsh-library)** | DeepSeek Harness 的本地文档知识库。 | |
| **[dsh-dsh-local-ai](https://github.com/PerryLink/dsh-dsh-local-ai)** | DeepSeek Harness 的本地模型（Ollama）接入。 | |
| **[dsh-dsh-lsp-actions](https://github.com/PerryLink/dsh-dsh-lsp-actions)** | 通过语言服务器的 LSP 诊断、格式化、补全、代码操作与重命名 | |
| **[dsh-dsh-mask](https://github.com/PerryLink/dsh-dsh-mask)** | PII 脱敏中间件：模型边界匿名化、展示层还原 | |
| **[dsh-dsh-mcp-panel](https://github.com/PerryLink/dsh-dsh-mcp-panel)** | 只读 MCP 运行时面板：/mcp 命令 + 带状态、工具与错误的 Settings 标签页 | |
| **[dsh-dsh-observe](https://github.com/PerryLink/dsh-dsh-observe)** | DeepSeek Harness 的 OpenTelemetry 与 Langfuse 可观测导出器。 | |
| **[dsh-dsh-output-styles](https://github.com/PerryLink/dsh-dsh-output-styles)** | Claude Code outputStyles 等价的运行时风格切换 | |
| **[dsh-dsh-permission-rules](https://github.com/PerryLink/dsh-dsh-permission-rules)** | Claude Code 风格声明式 allow/deny/ask 权限规则，带审计 | |
| **[dsh-dsh-plugin-guide](https://github.com/PerryLink/dsh-dsh-plugin-guide)** | 作为按需代理技能的插件开发知识库 | |
| **[dsh-dsh-research-report](https://github.com/PerryLink/dsh-dsh-research-report)** | 可验证研究报告引擎：内容寻址证据账本与封存版本 | |
| **[dsh-dsh-score](https://github.com/PerryLink/dsh-dsh-score)** | DeepSeek Harness 插件的多维质量评分。 | |
| **[dsh-dsh-session-pin](https://github.com/PerryLink/dsh-dsh-session-pin)** | 在 Web 侧栏置顶会话，带持久排序 | |
| **[dsh-dsh-session-sync](https://github.com/PerryLink/dsh-dsh-session-sync)** | DeepSeek Harness 的跨设备会话同步——会话存储的专用 git 镜像。 | |
| **[dsh-dsh-skill-pack-security](https://github.com/PerryLink/dsh-dsh-skill-pack-security)** | 安全审计技能包：密钥扫描、依赖与供应链审查 | |
| **[dsh-dsh-talk](https://github.com/PerryLink/dsh-dsh-talk)** | DeepSeek Harness 的语音优先会话闭环：对它说，听它答。 | |
| **[dsh-dsh-test-drive](https://github.com/PerryLink/dsh-dsh-test-drive)** | DeepSeek Harness 插件的隔离试装冒烟。 | |
| **[dsh-dsh-translate](https://github.com/PerryLink/dsh-dsh-translate)** | DeepSeek Harness 的厂商参数翻译与确定性 JSON 修复。 | |

## License

[Apache License 2.0](LICENSE) © 2026 dsh-memento contributors
