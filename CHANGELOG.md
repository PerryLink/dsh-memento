# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Host settings panel integration** — when the DSH settings service is mounted, the plugin registers the `dsh-memento` settings namespace (every `Config` field except `enabled`, plus a new `panel.enabled`), and its browser half contributes a card to **Settings → Plugins → Plugin configuration**. Edits persist to the settings user layer (`settings.yaml`) with staged-draft save/discard/per-field reset semantics. Nearly everything applies live: write policies, language, budgets, limits, proposals, panel; `dbPath` / `auditRetentionDays` apply by reopening the store (old one closed safely); `retrieval.vector` swaps the retriever in place; only `snapshotOrder` needs a DSH reload (changes are recorded as a `settings-startup-fields` audit row). Without the settings service the plugin behaves exactly as composed.
- **Hideable floating panel button** — new `panel.enabled` config (default `true`); `false` stops the web panel from rendering its 🧠 entry button (addresses upstream issue #7). The panel probes its own `/api/memento/entries` response at startup and falls back to showing the button when the probe fails.

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
