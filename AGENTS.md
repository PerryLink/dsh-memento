# AGENTS.md

`dsh-memento` 是 DeepSeek Harness 的能力接缝插件：为 DSH 补上有界、分层、带审批门、可审计的跨会话记忆。别的记忆插件卖仓库，本插件卖 `ctx.memory` 服务、写入审批门与会话日志可重建的审计。DSH 哲学是 **everything is a plugin**——本仓库只做插件，不碰引擎。改代码前先读 `README.md`（对外契约）、`ARCHITECTURE.md`（设计决策）与 `test/`（现有行为）。

## 仓库布局：发布面 / 本地工程面

根目录只放发布到 GitHub / npm 的文件；本地工程文件一律收进 `dev/`（gitignore，永不提交）。

```
index.mjs            插件入口（唯一 host 面文件）：服务/审批门/工具/快照段/适配器注册表注册
types.d.ts           类型契约：ctx.memory / ctx.memoryAdapters 服务与 memory/* SessionEventMap 声明合并
lib/constants.mjs    词汇表与协议常量（轨道/作用域/错误码/schema 版本/硬上限，零依赖）
lib/errors.mjs       结构化领域错误（code + details，零依赖）
lib/budget.mjs       每轨每层硬字符预算（纯函数，零依赖）
lib/match.mjs        唯一子串匹配（零/多命中语义，零依赖）
lib/gate.mjs         审批门策略与 reason 编解码（零依赖）
lib/protocol.mjs     协议 v1：写语义核心 MemoryProtocolCore + 条目/信封/审计校验（零 DSH 依赖）
lib/registry.mjs     适配器注册表（register 可逆 / list / adapt / export，零依赖）
lib/adapters.mjs     参考适配器：mem0 / hermes-memory-md / claude-code-memory-md（零依赖）
lib/snapshot.mjs     冻结快照渲染（纯函数，零依赖）
lib/workspace.mjs    工作区键规范化（Windows 大小写不敏感，零依赖）
lib/extract.mjs      会话事件文本抽取（memory_recall 历史片段用，零依赖）
lib/strings.mjs      模型可见/命令面双语词表（快照头/分组标题/提案头，零依赖）
lib/store.mjs        node:sqlite Provider：条目表+审计账本+迁移（零依赖）
client/client.js     Web 面板（零构建 vanilla，只读；en/zh 随 language 配置；经 dsh.client 注入；设置句柄两线解析：configForms / settingsScope）
scripts/             机械门：verify-readmes.mjs（五语一致性）、check-coverage.mjs（覆盖率）、verify-self-contained.mjs（拒绝仓库外依赖）、verify-artifacts.mjs（制品齐全+语法+导入）、loader-runner.mjs（真实 Loader composition，装 stderr log exporter）、typecheck-checkout.mjs、check-lockfile-drift.mjs
cordis.patch.yml     bundle 声明（insert memento；其 `id` 就是设置表单的 namespace，见 index.mjs 的 SETTINGS_ENTRY_ID）
package.json         npm 元数据；files 白名单 = 发布内容（含 docs/ 协议三件套与一致性套件）
package-lock.json    锁文件（CI 用，不进 npm 包）
tsconfig.check.json  tsc --checkJs 类型检查门
.github/workflows/   CI（三平台×双 Node）、每周 next-rc 兼容探针、v* 标签 npm 发布
README.md            英文主介绍（GitHub 默认页；五语源文）
README-{zh,es,pt,hi}.md   中/西/葡/印地语介绍（顶部互链，与英文同 commit 更新）
ARCHITECTURE.md      三角色 seam 架构图与全部设计决策
docs/protocol-v1.md(+.zh)       dsh-memory-protocol v1 规范（双语；docs/schemas/ 为规范性 JSON Schema）
docs/adapters-guide.md(+.zh)    第三方插件接入指南（双语）
docs/upstream-proposal.md(+.zh) 官方 ctx.memory seam 采纳论证与迁移路径（双语）
test/                单测 + mock ctx 集成测试（进 GitHub）
test/protocol-conformance/  协议一致性套件（可对外分发：进 GitHub 也进 npm 包）
LICENSE / THIRD_PARTY_NOTICES.md   Apache-2.0 + 复用出处标注
dev/                 ❌ 本地工程面：冒烟脚本、夹具、演示——永不提交
```

- 新增被 `index.mjs` import 的模块必须同步加进 `package.json` 的 `files`。
- **行为变更需同步五语 README**：以 README.md（英文）为源，中/西/葡/印地四语同 commit 更新；顶部互链行与 Topics 行保持五语一致。
- **永不提交**：`dev/`、`node_modules/`、真实用户记忆库（含敏感内容）、任何凭据/密钥。

## 命令

```sh
npm install             # 安装 peer 依赖（@deepseek-ai/dsh-tools、schemastery 等）
npm test                # node --test 跑 test/*.test.mjs（含协议一致性套件的仓库门）
npm run coverage        # 展示内置覆盖率报告
npm run lint            # oxlint 静态检查
npm run check:coverage  # 覆盖率门：lib ≥90%、index.mjs ≥85%、all files ≥90%
npm run typecheck       # checkout 面类型尺子（paths → D:\deepseek-harness，缺 checkout 则"不可验证"并 exit 0）
npm run typecheck:ci    # 已发布线类型尺子（node_modules 里钉住的那版）
npm run check:client    # 浏览器半类型尺子（DOM lib）
npm run check:readmes   # 五语 README 一致性门
npm run verify:self-contained # 拒绝 file/link/portal/workspace/git 等仓库外依赖 spec
npm run verify:artifacts # 发布文件齐全 + 语法检查 + 纯 Node import 冒烟
npm run check:lockfile  # package.json 与 pnpm-lock.yaml 漂移门（只读探针）
npm run test:conformance  # 协议一致性套件（黄金参考；第三方 Provider 用 run.mjs --provider）
```

无构建步骤：纯 ESM，`index.mjs`/`lib/` 即发布产物。**两份锁文件都要维护**：`ci.yml` 用 `npm ci`（package-lock.json），`compat.yml` 与 `check:lockfile` 用 pnpm（pnpm-lock.yaml）。

## 提交纪律

- conventional commit 前缀：`feat:` / `fix:` / `refactor:` / `chore:` / `docs:` / `test:`，中文描述。
- 一个逻辑变更一个 commit；每完成一个 F 需求模块跑 `npm test` 后提交。
- 提交前必过：`npm test` 全绿；`git status` 无杂物；`git diff --cached --check` 无空白错误。
- 行为变更同 commit 更新测试与五语 README。

## DSH 插件约束（红线）

- **只消费公开服务**：`tools`、`systemPrompt`、审批 seam（`inject` 声明）。不修改 DSH 引擎 / agent-loop / apiproxy / 官方 UI 包。
- **注册即 effect**：一切贡献走 `ctx.effect()` / `ctx.on()` / 服务 `register()`（返回 disposer）；绝不手动收尾。
- **模型可见 ⟺ 落盘**：注入模型的快照文本可自会话日志重建（system/message + snapshot 审计行 + 审批 reason 携带完整载荷）。
- **审批门不可绕过**：写路径的强制点位于 `MemoryProtocolCore`（`lib/protocol.mjs`）写方法内部（`MemoryService` 继承它并注入 `ctx.approval.request` 传输），不在工具层；`writePolicy` 是 Config，模型不可见、不可改；禁用（`enabled:false`）时一切贡献整体消失，不留半残状态。
- **失败要大声**：库损坏/版本过新/非法配置在加载期抛错；写满报 `BUDGET_EXCEEDED`；子串歧义报 `AMBIGUOUS_MATCH`；绝不静默吞、绝不静默截断。
- **本地优先**：零网络、零凭据；记忆库只写 `dbPath`（默认 `$DSH_HOME/dsh-memento/memory.db`），POSIX 权限 0600。
- **systemPrompt 提供者必须同步**（0.1.2-rc.1 不 await）：SQLite 同步读 + WeakMap 按 Session 冻结。

## 会话事件的 alpha.5 约束（必读）

本插件在 `types.d.ts` 声明了 `memory/added|updated|removed|recalled|snapshot` 的 SessionEventMap 合并，但**运行时默认不向会话日志 append 这些事件**：截至 0.1.2-rc.1 harness 仍无插件事件注册面（`KNOWN_SESSION_EVENT_TYPES` 不含 memory/*，且 `Session.append` 写入面不接受 `ignorable` 标记），append 未注册类型会让该会话下次加载被持久化层拒绝。审计链由审批 seam 的 `approval/asked + approval/decided`（已知事件类型）与插件审计表承担；未来 harness 收录 memory/* 后自适应开启。**不要"顺手"取消这个自适应门。**

## 设置面的 alpha.7 契约（必读）

**0.1.7-alpha 起设置面反转，插件不再注册任何东西**：`installSettingsSection` / `SettingsProvider.installSection` / `SettingsNamespace` / `SettingsScope` 整族已删（`@deepseek-ai/dsh-settings-file` 整包消失，`dsh-settings` 现在只有 `SettingsForms`），客户端 `ctx.settingsScope` 也已删。新契约：**插件的 `Config` 就是它的设置面**——表单 namespace = profile entry id（本仓 = `cordis.patch.yml` 的 `id: memento` = 导出的 `SETTINGS_ENTRY_ID`），可编辑字段 = 标了 `.volatile()` 的字段，被接受的编辑由 Loader **提交进 `apply` 收到的实时引用**并发 `loader/volatile-update`（volatile-only 提交**不重挂 fiber**）。因此：

- **只对本来就是用户可配置的字段标 volatile**（`SHARED_CONFIG_FIELDS` + `panel`）；`enabled` 是组合面开关，旧线同样不在面板里，保持普通字段。嵌套对象整对象标（schemastery 拒绝 volatile 套 volatile）。
- `configure({ auto: false }, ctx.fiber)` 必须包在 `ctx.effect` 里持有 disposer——`SettingsForms.configure` 对同一 fiber 重复调用会抛；`auto:false` 是「自带设置页」的声明（本插件在 `settings.section` 有自定义卡片），别改成 `true`。
- 值来源**必须懒读**（每次读重新解引用）；把 config 在 apply 开头冻成快照会让此后每一次热编辑都静默失效。
- 注册期固定的面（工具描述文案、快照段顺序）在 volatile 编辑后**不会**跟着变，只能重载——这是与旧线的唯一行为差异，`onChange` 里对 `snapshotOrder` 写 `settings-startup-fields` 审计行。
- `.volatile()` 是 **3.18.3 起的运行期方法**，schema 在模块求值期构建：裸调用会让 peer 范围仍声明支持的 `0.1.2-rc.1` / `0.1.5-alpha.1` / `0.1.6-0` 线在 import 阶段硬崩。一律经 `liveField()` 探测；旧宿主上字段保持普通值，设置面走保留下来的 `installSection` 形状分派。
- 注册面能表达的约束搬进 schema（`.pattern()` / `min` / `max` / `step(1)`）——设置编辑器在**持久化前**用 schema 解析合并后的 config；schemastery 3.18.3 **没有 `.check()`**，跨字段规则（`writePolicies` 键文法、`budgets` 形状）只能留在 `validateMemoryConfig`（加载期 + 运行期，被拒的实时编辑留 `settings-rejected` 审计行）。
- 浏览器半**不要把任一设置服务写进 `inject`**（`configForms` / `settingsScope`）：两条线各只有一个在场，写进去会让对面宿主的 fiber 永久 PENDING，连只读浮层面板一起消失。解析走 `resolveSettingsScope` 的可选读取，缺席降级只读。

## 质量约定

- 文件以恰好一个换行结尾；空 `catch` 说明吞掉什么且 `try` 只包一条语句；不注释显而易见的事实。
- `lib/` 保持零 DSH 依赖：任何 DSH 依赖只允许出现在 `index.mjs`；`lib/` 只依赖 node: 内置模块。
- 测试描述行为而非背书正确性；fixtures 用合成数据，永不掺真实用户记忆。
- 复用他人代码处标注 license 与出处（THIRD_PARTY_NOTICES.md + 文件头注释）。

## 编辑本文件

规则保持自包含；改完须与仓库现状一致。
