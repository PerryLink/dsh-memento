# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Web panel entries route now honors the `limit` query parameter and renders a truncation notice (previously >20 entries were silently capped).
- `/memory list` / `query` render at most `commandListLimit` entries and label truncation instead of silently dropping rows.
- `seed` inserts run in one SQLite transaction: any mid-batch failure rolls back the whole batch (the documented all-or-nothing promise now holds).
- `replace` re-resolves the target and recomputes the net budget delta after approval, closing the stale-previous race during the approval wait.
- Audit rows record the real decision source (`via approval, writePolicy …` vs `via write gate`) instead of always labeling the configured policy.
- `memory_recall` description now states the true case semantics (case-sensitive for memory entries, case-insensitive for session history).
- `maxEntriesPerQuery` is documented and enforced as the default result cap; explicit `limit` values are hard-capped at 1000 by the provider.

### Added

- `commandListLimit` (default 50) and `commandAuditLimit` (default 10) config fields for the `/memory` command surface.
- Coverage gate (`npm run check:coverage`: lib ≥90%, index.mjs ≥85%, all files ≥90%) and a weekly `next`-rc compatibility probe workflow.
- Peer dependency ranges widened to `>=0.1.0-rc.6` so later harness rc releases resolve without a coordinated release.
- Package metadata (`repository`/`homepage`/`bugs`), `types` conditions on the `exports` map, and this changelog.

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
