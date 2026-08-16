# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
