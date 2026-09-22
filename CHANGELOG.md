# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **适配 DeepSeek Harness `dsh-v0.1.7-alpha.1`（设置契约反转）**。`0.1.7` 线删掉了整条 settings 注册面（`installSettingsSection` / `SettingsProvider.installSection` / `SettingsNamespace` / `SettingsScope`，`@deepseek-ai/dsh-settings-file` 整包消失，`dsh-settings` 现在只有 `SettingsForms`），并删掉了客户端的 `ctx.settingsScope` 服务。两半各自迁移：
  - **宿主半**：插件自己的 `Config` 就是设置面——表单 namespace = profile entry id（`cordis.patch.yml` 的 `id: memento`，新导出 `SETTINGS_ENTRY_ID`），可编辑字段 = 标了 `.volatile()` 的字段。可编辑面**逐字段对齐旧线**（`SHARED_CONFIG_FIELDS` + `panel`；`enabled` 保持普通字段，旧线同样不在面板里）；`panel.enabled` 因此第一次成为 `Config` 字段——新契约下它没有别的可写去处。`apply` 改为 `ctx.effect(() => settings.configure({ auto: false }, ctx.fiber))`（自带设置页 ⇒ 不生成重复表单），值来源改为懒读 volatile 引用，启动期字段的副作用在 `loader/volatile-update` 上对账。
  - **浏览器半**：`ctx.settingsScope.bind({ namespace })` 换成 `ctx.configForms.get(entryId)`；`inject` 从 `['slots', 'settingsScope']` 收成 `['slots']`——两条线的服务各只有一个在场，任一个写进 `inject` 都会让对面宿主的 fiber 永久 PENDING（不只设置卡片，只读浮层面板也一起消失）。旧线仍走 `settingsScope` 分支，两者都不在场时卡片降级为只读而不是抛错。
- **行为变更**：volatile 字段经设置面编辑**不再重挂 fiber**（这是新契约的全部意义），因此注册期固定的面——工具描述文案、快照段注入顺序——改为重载后跟随；命令/快照/面板的热字段即时生效不变。数值下限（正整数 / 非负整数）搬进 schema：越界编辑在**持久化前**被宿主拒绝，而不是等到下次加载才把插件打成非法配置。跨字段规则（`writePolicies` 键文法、`budgets` 形状）在 schemastery 3.18.3 里无法表达（没有 `.check()`），仍是加载期/运行期的响亮拒绝——被拒的实时编辑留 `settings-rejected` 审计行。

### Added

- `.volatile()` 的能力探测（`liveField`）：`.volatile()` 是 schemastery 3.18.3 起的**运行期**方法，而 schema 在模块求值期构建，裸调用会让 peer 范围仍声明支持的 `0.1.2-rc.1` / `0.1.5-alpha.1` / `0.1.6-0` 线在 mount 时硬崩。旧宿主上字段保持普通值，设置面走保留下来的 `installSection` 形状分派，行为与迁移前一致。
- `test/client.test.mjs`：用 `node:vm` 提供宿主注入环境（`window.__ModuleLoader__` + 平台 `react` + 最小 DOM），驱动浏览器半并断言 `inject` 只有 `slots`、两条设置线各自解析到正确句柄/namespace、缺席时降级只读、保存经 `ConfigForm.set(field, value)` 的调用形状。
- `scripts/loader-runner.mjs` 装一条 stderr log exporter：cordis 的 logger 默认只**缓冲**，而 Loader 1.0.4 起把「entry 导入失败 / config 解析失败」经 `ctx.logger.error` 报出后**返回**（不再 reject `loader.await()`），没有 sink 时 composition 的两个负例退化成「静默没挂上」。

### Development

- devDependencies 改钉 `0.1.7-alpha.1`（= 验证过的宿主 tag；`0.1.5-rc.3` 经实测否决——它仍是旧 settings 契约且其 schemastery 没有 `volatile()`），`@deepseek-ai/cordis` 到 `^4.0.3`、`@deepseek-ai/schemastery` 到 `^3.18.3`、`@deepseek-ai/cordis-plugin-loader` 到 `^1.0.4`（第一个声明 `loader/volatile-update` 的发布）、`@deepseek-ai/cordis-plugin-include` 到 `^1.0.8`（与宿主 vendor 副本同版）。`pnpm-workspace.yaml` 用**裸包名** overrides 钉住 cordis 4.0.3 / cosmokit 1.8.4 / schemastery 3.18.3 三条下限：名义范围虽覆盖，但已钉旧 patch 的 lockfile 会继续解析到旧版。
- 每个 `@deepseek-ai/dsh-*` peer 范围追加 `|| >=0.1.7-0 <0.2.0`（只加宽）。这一段本身是修 bug：旧范围因 semver 的预发布规则**把目标宿主 0.1.7-alpha.1 排除在外**。`engines.dsh`、`dshWorkshop.compatibility.dshVersions` 与 Compat workflow 同步。
- `test/helpers/mock-ctx.mjs` 的 `inject` 回调改为交付**子 Context**（真 cordis：`inject` = `ctx.plugin({ inject, apply })`，回调拿到子 fiber 的 Context，既有服务属性面也有 `get`/`effect`/`on`），并在服务替换时先卸载旧子 fiber 再重跑回调——`configure` 的重复保护、策略的释放与重注册都靠这一条才量得到。

## [0.5.14] - 2026-09-19

### Added

- `pnpm run check:lockfile` (`scripts/check-lockfile-drift.mjs`) fails fast when `package.json` and `pnpm-lock.yaml` disagree; the probe is read-only and the documented checks chain runs it alongside the other gates.

### Changed

- The release workflow now publishes through **npm trusted publishing** (OIDC) instead of the long-lived `NPM_TOKEN` secret: `setup-node` no longer sets `registry-url` (its empty `_authToken` line made the registry answer 404 on PUT), npm is upgraded to >= 11.5.1 before publishing, and the "NPM_TOKEN is not set -> skip" guard is gone so a missing publisher cannot turn a release into a silent no-op.
## [0.5.13] - 2026-09-18

### Added

- The host checkout's type face is now a real second ruler instead of a duplicate command. `tsconfig.check.json` resolves every `@deepseek-ai/*` import through `paths` into the built `lib/types` of a local `D:\deepseek-harness` checkout (currently `dsh-v0.1.6-alpha.2`), while `tsconfig.check.ci.json` keeps resolving the pinned published line from `node_modules`. Measured counterexamples on this machine: a neutral type error fails both rulers (1/1), an alpha.2-only member (`SessionMessageProjection`) passes the checkout ruler and fails the published one (0/1), and a structural session passed into a class-typed approval seam does the opposite (1/0). `npm run typecheck` runs it through `scripts/typecheck-checkout.mjs`, which prints "not verifiable" and exits 0 when the checkout is absent (CI runners), so the runner never gets a permanently red step.
- `client/client.js` is now inside a type gate of its own: `tsconfig.check.client.json` (DOM lib) plus a new `check:client` script, both wired into `ci.yml` alongside the other two rulers. The browser half previously had no type evidence at all (a same-named `client/client.d.ts` subpath anchor made TypeScript skip the runtime file); 66 `checkJs` findings were resolved with JSDoc annotations only.

### Changed

- The session audit gate reports itself in three states (`'appended' | 'skipped-unknown-type' | 'no-session'`) and warns exactly once per process on the first skip. `/memory audit` now appends a line naming the gap: the session-log side of the audit is not written, because the harness does not know the `memory/*` session event types and appending them would make the session unloadable. The notice disappears on its own once the host knows `memory/added`. The gate stays adaptive; appending is never changed to a bare call.
- `retrieval.vector` hot swaps are transactional: the new retriever is built before the old one is unregistered, so a failure can no longer leave `vector` configured with nothing registered. A failed swap leaves an `settings-swap-failed` audit row, reverts the field to the value that actually took effect, and is retried on the next change of that value. The self-held retriever disposer is also cleared when the fiber unloads, so a late settings callback cannot call a stale disposer twice.

### Docs

- `types.d.ts` states the session-event contract as "vocabulary present, write channel absent" and lists the four host lines the gate was re-checked against (0.1.5-rc.6, 0.1.2-rc.1, 0.1.3-alpha.1, 0.1.6-alpha.2).

## [0.5.12] - 2026-09-12

### Changed

- Rename the four translated READMEs to `README-<lang>.md`. npm selects the package-page readme as the first markdown file matching its `{README,README.*}` glob (`@npmcli/package-json`, publish path), and that glob order puts `README.<lang>.md` ahead of `README.md` — so npm was serving the Simplified-Chinese file for this package too (measured on 15/15 sampled packages of the family). The new names sit outside the glob, so the English source is served again. No content changed apart from the language-switcher link each translation holds to its siblings, and the repo readme gate still passes. Takes effect with the next release; an already-published version cannot gain a corrected readme retroactively.

- The release workflow now creates the GitHub Release itself, with the body taken from this version's CHANGELOG section. Until now a `v*` tag published to npm and stopped there, so every Release page had to be created by hand afterwards.
- Pin the `@deepseek-ai/dsh-*` dev/test dependencies to the published `0.1.5-rc.2` line and record `0.1.5-rc.2` in `dshWorkshop.compatibility.dshVersions`; the monthly Compat workflow now runs against `0.1.5-rc.2`. The peer range `>=0.1.2-rc.1 <0.2.0 || >=0.1.5-alpha.1 <0.2.0` is unchanged, so no supported host line is dropped.

## [0.5.11] - 2026-09-10



### Changed

- Pin the `@deepseek-ai/dsh-*` dev/test dependencies to the published `0.1.5-rc.1` line and record `0.1.5-rc.1` in `dshWorkshop.compatibility.dshVersions`; the monthly Compat workflow now runs against `0.1.5-rc.1`. The peer range `>=0.1.2-rc.1 <0.2.0 || >=0.1.5-alpha.1 <0.2.0` is unchanged, so no supported host line is dropped.

### Docs

- Refresh the five-language README compatibility baseline to `dsh-v0.1.5-rc.1` (verified 2026-09-10).

## [0.5.10] - 2026-09-09

### Changed

- Align the `@deepseek-ai/dsh-*` peer ranges to `>=0.1.2-rc.1 <0.2.0 || >=0.1.5-alpha.1 <0.2.0` and pin the dev/test dependencies to the published `0.1.5-alpha.1` line: adaptation to DeepSeek Harness `dsh-v0.1.5-alpha.1` (session format V3, `ctx.agent` removal, `Inbox` type-only interface); runtime behavior is unchanged for every supported host line.
- Record `0.1.5-alpha.1` in `dshWorkshop.compatibility.dshVersions`.

### Docs

- Refresh the five-language README compatibility baseline to `dsh-v0.1.5-alpha.1` (verified 2026-09-09).

## [0.5.9] - 2026-09-08

### Docs

- Repair GBK mojibake in historical CHANGELOG entries: em dashes, arrows, comparison signs, the multiplication sign, a mangled emoji (U+9983 U+E765), and the mangled Chinese appendix label (U+6D93 U+E15F U+6783) are restored to the clean pre-corruption text; no behavior change.


## [0.5.8] - 2026-09-07

### Docs

- Fix the DSH plugin badge URL: shields.io rejects the four-segment static badge form with "404 badge not found"; the label now uses the documented double-dash form (`dsh--plugin`), rendering identically; no behavior change.


## [0.5.7] - 2026-09-07

### Fixed

- Complete the 0.5.6 peer-range alignment: `@deepseek-ai/dsh-settings` was still on the old `>=0.1.0-rc.1 <0.2.0` band (the same prerelease-tuple flaw that 0.5.6 fixed elsewhere), and `package-lock.json` still carried the stale `>=0.1.0-rc.8` ranges; package.json peers and the lockfile are now uniformly `>=0.1.2-rc.1 <0.2.0` (detected by the `dsh-plugin-doctor` R8 check); no behavior change.

## [0.5.6] - 2026-09-07

### Fixed

- Align the `@deepseek-ai/dsh-*` peer ranges to `>=0.1.2-rc.1 <0.2.0`: the older `>=0.1.0-rc.8 <0.2.0` band resolved to only the `0.1.0-rc.8` prerelease under registry-driven resolution and broke fresh tarball installs; no behavior change.

### Docs

- Refresh the five-language README support-version wording: the verified GitHub tag `dsh-v0.1.3-alpha.1` now leads the compatibility claim, while npm `0.1.2-rc.1` stays the published dependency-pin line (peers `>=0.1.2-rc.1 <0.2.0`); no behavior change.


## [0.5.5] - 2026-09-04

### Changed

- Align the devDependency pins to the published dsh `0.1.2-rc.1` line, move the compat CI probes from `0.1.2-alpha.5` to `0.1.2-rc.1`, and refresh the version notes (the adaptive session-event gate keeps staying closed on rc.1); no behavior change.

## [0.5.4] - 2026-09-03

### Added

- **Host settings panel integration** — when the DSH settings service is mounted, the plugin registers the `dsh-memento` settings namespace (every `Config` field except `enabled`, plus a new `panel.enabled`), and its browser half contributes a **top-level `dsh-memento` entry to the DSH settings sidebar** (via the public `settings.section` slot, like the built-in sections). Edits persist to the settings user layer (`settings.yaml`) with staged-draft save/discard/per-field reset semantics. Nearly everything applies live: write policies, language, budgets, limits, proposals, panel; `dbPath` / `auditRetentionDays` apply by reopening the store (old one closed safely); `retrieval.vector` swaps the retriever in place; only `snapshotOrder` needs a DSH reload (changes are recorded as a `settings-startup-fields` audit row). Without the settings service the plugin behaves exactly as composed.
- **Hideable floating panel button** — new `panel.enabled` config (default `true`); `false` stops the web panel from rendering its 🧠 entry button (addresses upstream issue #7). The panel probes its own `/api/memento/entries` response at startup and falls back to showing the button when the probe fails.

### Changed

- Dev pins `@deepseek-ai/cordis-plugin-loader ^1.0.3` / `@deepseek-ai/cordis-plugin-include ^1.0.7` aligned with the `cordis 4.0.2` peer ranges.

## [0.5.3] - 2026-09-02

### Docs

- Sync the five-language READMEs to the 0.1.2-alpha.5 facts; no behavior change.

## [0.5.2] - 2026-09-02

### Changed

- Compatibility baseline raised to **0.1.2-alpha.5**: the `@deepseek-ai/dsh-session` / `@deepseek-ai/dsh-tools` / `@deepseek-ai/dsh-attachment` dev dependencies are pinned to `0.1.2-alpha.5`, `dshWorkshop.compatibility.dshVersions` lists `0.1.2-alpha.5`, and the compat probe pins are raised to `0.1.2-alpha.5`. The adaptive session-event gate stays closed on `0.1.2-alpha.5` (`KNOWN_SESSION_EVENT_TYPES` still lacks `memory/*` and `Session.append` still cannot stamp the `ignorable` envelope), so behavior is unchanged.

## [0.5.1] - 2026-09-01

### Changed

- Compatibility baseline raised to **0.1.2-alpha.3**: the `@deepseek-ai/dsh-session` / `@deepseek-ai/dsh-tools` / `@deepseek-ai/dsh-attachment` dev dependencies are pinned to `0.1.2-alpha.3`, `cordis`/`schemastery` dev pins move to `^4.0.2`/`^3.18.2` (the `schemastery` peer keeps `>=3.0.0`), `dshWorkshop.compatibility.dshVersions` lists `0.1.2-alpha.3`, and the compat probe pins are raised to `0.1.2-alpha.3`. The adaptive session-event gate stays closed on `0.1.2-alpha.3` (`Session.append` still cannot stamp the `ignorable` envelope), so behavior is unchanged.

## [0.5.0] - 2026-08-26

### Added

- **Embedding Provider seam (`ctx.memoryEmbedding`)** — new `lib/embedding.mjs` registry ships a deterministic fake-hash provider by default, so third-party plugins can register real embedding backends behind the same Service Definition.
- **Retrieval Provider seam (`ctx.memoryRetrieval`)** — new `lib/retrieval.mjs` registry keeps the built-in substring retriever as the zero-dependency main path and adds an optional `VectorRetriever` for semantic recall, enabled when `config.retrieval.vector` is `true` and an embedding provider is detected (graceful fallback to substring otherwise).
- **stdio MCP server export** — new `bin/mcp-server.mjs` and `lib/mcp.mjs` expose the memory seam as an MCP server through the `dsh-memento-mcp` bin.

## [0.4.5] - 2026-08-23

### Changed

- Development docs sync (no functional change): the five-language READMEs now record the current test count (**141**, up from 133) and list the complete gate set (`lint`, `verify:self-contained`, `verify:artifacts`) alongside the existing gates; `AGENTS.md`'s `scripts/` map and command list now include the same three gates plus the `loader-runner.mjs` real-Loader runner.

## [0.4.4] - 2026-08-22

### Changed

- DeepSeek Harness compatibility baseline raised to **0.1.1-rc.2**: `@deepseek-ai/dsh-session` / `@deepseek-ai/dsh-tools` dev dependencies pinned to `0.1.1-rc.2`, `dshWorkshop.compatibility.dshVersions` updated to `["0.1.1-rc.2"]`, and the `compat.yml` probe pins raised to `0.1.1-rc.2`. Peer ranges stay `>=0.1.0-rc.8 <0.2.0` (no rc.2-only API is required).
- Adaptive session-event gate re-verified on rc.2 and kept closed: rc.2 still ships no plugin event registration surface (`KNOWN_SESSION_EVENT_TYPES` has no `memory/*`) and `Session.append` still offers no writer-side `ignorable` marker (its third arg is surface intent only), so appending unregistered types would still make a session unloadable. The two-arg `session.append(type, data)` shape remains correct for non-surface events. Comments in `index.mjs` / `types.d.ts` / `AGENTS.md` and the five-language READMEs now record this rc.2 verification. All gates pass against rc.2 (141 tests, protocol conformance 22/22, typecheck, lint, coverage, five-language README check, self-contained/artifact verification).

## [0.4.3] - 2026-08-21

### Changed

- DeepSeek Harness compatibility baseline raised to **0.1.0-rc.8**: `@deepseek-ai/dsh-session` / `@deepseek-ai/dsh-tools` peer ranges now `>=0.1.0-rc.8 <0.2.0`, dev dependencies pinned to `0.1.0-rc.8`, and `dshWorkshop.compatibility.dshVersions` updated to `["0.1.0-rc.8"]`. All gates (141 tests, protocol conformance 22/22, typecheck, lint, coverage, five-language README check, self-contained/artifact verification) pass against rc.8.
- Adaptive session-event gate re-verified on rc.8 and kept closed: rc.8 still ships no plugin event registration surface (`KNOWN_SESSION_EVENT_TYPES` has no `memory/*`) and `Session.append` still offers no writer-side `ignorable` marker, so appending unregistered types would still make a session unloadable by the persistence layer. Comments in `index.mjs` / `types.d.ts` / `AGENTS.md` now record this rc.8 verification.

## [0.4.2] - 2026-08-19

### Changed

- `package.json#dshWorkshop.lifecycle.activation` upgraded from `restart-profile` to `hot-reload`: with the panel routes riding the plugin fiber since 0.4.1, dispose-and-reactivate is fully clean. Proven by a Loader-level hot-reload composition test that drives `Include.refresh()` — the same transaction the HMR watcher triggers — through a `language` en → zh → en cycle against a duplicate-strict mock `webServer`, asserting the memory seam, the re-applied config, and the routes re-registering without a duplicate route.

## [0.4.1] - 2026-08-19

### Fixed

- The panel routes now unload with the plugin fiber: the three `/api/memento/*` route disposers ride one `ctx.effect`, so a config hot-reload or disable followed by a remount no longer throws `duplicate exact route` (the host route table previously kept handlers closed over the unloaded fiber). Regression covered by a dispose-and-remount lifecycle test against a duplicate-strict route table.

## [0.4.0] - 2026-08-16

### Added

- **dsh-memory-protocol v1** — the community rehearsal of the DSH memory protocol: normative spec in `docs/protocol-v1.md` (+ 中文), machine-readable JSON Schema in `docs/schemas/dsh-memory-protocol-v1.schema.json`, entry spec extended with `tags` (≤16 × ≤32 chars) and a per-entry `version` that increments on every `replace` (store schema v4, forward-migrated).
- **Protocol/implementation separation** — write semantics moved into `lib/protocol.mjs` (`MemoryProtocolCore`, zero DSH dependencies); `MemoryService` is now a thin subclass that only injects the approval transport and the session-event emission gate. Behavior is unchanged.
- **Adapter registry `ctx.memoryAdapters`** — reversible `register()`/`list()`/`adapt()`/`export()` plus three built-in reference adapters: `mem0`, `hermes-memory-md`, `claude-code-memory-md` (pure data converters — never model extraction). New command verbs: `/memory adapters`, `export --adapter=<id>` (read-only), `import --adapter=<id> <path|inline>` (rides the approval-gated `seed`, per-entry audit). Onboarding guide in `docs/adapters-guide.md` (+ 中文).
- **Protocol conformance suite** — `test/protocol-conformance/`: 22 distributable cases (entry model, write semantics, budget model, audit reconstruction, export envelope) with a `--provider` CLI for third parties; CI runs them against dsh-memento's own provider as the golden reference (`npm run test:conformance`).
- **Upstream proposal material** — `docs/upstream-proposal.md` (+ 中文): why the official `ctx.memory` seam should adopt the protocol, differences from the current seam, and the migration path.
- `memory` tool accepts optional `tags` on add/replace/consolidate; tool results and `/memory export` documents carry `tags`/`version`.

### Changed

- Five-language READMEs: protocol section, adapter matrix, conformance suite, new command verbs, and the development gate list (now 133 tests).
- ARCHITECTURE: decisions 13–15 (protocol separation, schema v4, adapter registry + conformance suite).
- npm package now ships the protocol docs and the conformance suite (`files` whitelist).

## [0.3.1] - 2026-08-15

### Fixed

- Boot crash on default Windows setups (reported in [issue #1](https://github.com/PerryLink/dsh-memento/issues/1)): `dsh web` does not write the harness's resolved home back to `process.env.DSH_HOME`, so `resolveDbPath` threw `MISSING_DSH_HOME` and failed the whole profile load. It now falls back to `~/.dsh` — the same documented fallback as the official harness (`resolveDshHome()`), replicated with `os.homedir()` to keep `lib/` zero-DSH-dependency. Relative `dbPath` values resolve against the same fallback home.
- Removed the now-unreachable `MISSING_DSH_HOME` error code.

## [0.3.0] - 2026-08-15

### Added

- `/memory import` subcommand: restores entries from a `/memory export` document (file path or inline JSON starting with `{`). Validates the `dsh-memento` / `memory-export-v1` markers and entry shapes (unknown schema versions fail loudly), caps one import at 1000 entries, then rides `seed` — single approval, full budget pre-check, one atomic transaction. `source`/`workspaceKey`/`agentKey` survive the round-trip; entries get fresh ids/timestamps and reset recall counts. This completes the backup/migration story.
- Approve-what-you-see approval payloads: `replace` carries `from:` (full previous entry) + `to:` (new text), `remove` carries the full text of the entry being deleted (no more bare substrings), and `consolidate` carries each target's resolved text (300-char excerpt cap per target) — the approval reason now holds the complete change being authorized.
- `*-denied` audit rows: every rejected/cancelled/unavailable write (including the turn-outside `/memory` gate path, which has no approval audit pair) lands a denied row with the real decision source — denials now have their own evidence chain.
- Session-visibility isolation for reads and write targeting: `memory` / `memory_recall` queries filter by the session's `agentPreset` (shared + own agent), and `replace`/`remove`/`consolidate` can only target entries visible to the session (shared + own agent, workspace entries only for the session cwd). Management surfaces (`/memory`, the panel) keep the full cross-agent view and now render non-shared entries' agent keys.
- `query` accepts an explicit `agentKey` option (`service.query(filter, { agentKey })`); without it, behavior is unchanged (full view, backward compatible).

### Fixed

- `proposalDecide` now resolves and updates inside one transaction: concurrent approve/dismiss races settle first-writer-wins instead of double-deciding.
- `/memory proposals approve` no longer masks a successful write when the proposal was concurrently decided elsewhere.
- Release workflow is now idempotent: it skips `npm publish` when the tag's version is already on npm, so re-pushing an old tag cannot fail a run.
- Cross-platform test fix: the `resolveDbPath` absolute-path sample now matches the platform's `path.isAbsolute` semantics (a Windows drive path is relative on POSIX) — CI is green on all three platforms instead of red on Linux/macOS.

### Changed

- Five-language READMEs: npm install line (package published since 0.2.0), `import` in the command list, the approval-payload and visibility semantics, and the test count.
- ARCHITECTURE decisions 2/5/6/8/11 updated for the payload, denied-audit, visibility, and import semantics; the readme gate now also enforces the `import` token across all five languages.

## [0.2.0] - 2026-08-14

### Added

- `language` config (`'en'` default / `'zh'`): model-visible text, the frozen snapshot, `/memory` command output, and the web panel all switch languages; invalid values fail loudly at load.
- `/memory export` subcommand: read-only JSON dump of all entries + budgets (backup / migration / transparency).
- Web panel renders `en`/`zh` labels according to the plugin's `language` (the language travels with the `/api/memento/*` responses).
- Bilingual `memory_recall` tool description, parameter descriptions, and result renderer.
- New README section "What we learned from the terminal memories" (Claude Code / Codex / Hermes), mirrored across all five languages.
- `commandListLimit` (default 50) and `commandAuditLimit` (default 10) config fields for the `/memory` command surface.
- Coverage gate (`npm run check:coverage`: lib ≥90%, index.mjs ≥85%, all files ≥90%) and a weekly `next`-rc compatibility probe workflow.
- Peer dependency ranges widened to `>=0.1.0-rc.6` so later harness rc releases resolve without a coordinated release.
- Package metadata (`repository`/`homepage`/`bugs`), `types` conditions on the `exports` map, and this changelog.

### Fixed

- Web panel entries route now honors the `limit` query parameter and renders a truncation notice (previously >20 entries were silently capped).
- `/memory list` / `query` render at most `commandListLimit` entries and label truncation instead of silently dropping rows.
- `seed` inserts run in one SQLite transaction: any mid-batch failure rolls back the whole batch (the documented all-or-nothing promise now holds).
- `replace` re-resolves the target and recomputes the net budget delta after approval, closing the stale-previous race during the approval wait.
- Audit rows record the real decision source (`via approval, writePolicy …` vs `via write gate`) instead of always labeling the configured policy.
- `memory_recall` description now states the true case semantics (case-sensitive for memory entries, case-insensitive for session history).
- `maxEntriesPerQuery` is documented and enforced as the default result cap; explicit `limit` values are hard-capped at 1000 by the provider.

## [0.1.0] - 2026-08-14

### Added

- `ctx.memory` service seam (Service Definition): `budgets` / `add` / `replace` / `remove` / `query` / `seed`, with the approval gate forced inside the write methods.
- Local SQLite provider (`node:sqlite`, WAL, `0600`): entries + audit tables, unique-substring replace/remove, migrations with loud version checks.
- Approval-gated write policy (`ask` / `auto` / `off`, model-invisible) with a prepend answerer on the `approval/request` waterfall.
- `memory` tool with structured results, Save/Skip guidance, and pure renderers.
- Frozen per-session snapshot injection via a `systemPrompt` section (order `-50`), reconstructed verbatim from `request/header.system` plus audit rows.
- `memory_recall` tool: two-part recall over memory and session history with graceful degradation.
- `/memory` command (`list` / `query` / `add` / `remove` / `budgets` / `audit`) with an out-of-turn write gate sharing the same waterfall and policy.
- Read-only web panel (`dsh.client` drawer): browse entries, search, budget bars, audit tail.
- Session-event vocabulary (`memory/added|updated|removed|recalled|snapshot`) merge-declared in `types.d.ts` with rc.6-adaptive dispatch.
- Hard per-track/per-layer character budgets with structured `BUDGET_EXCEEDED` errors — never truncate, never auto-compact.
- CI matrix (three platforms × Node 22.19/24), typecheck gate, and five-language README consistency gate.
