# OMDSH Review (author-declared, static)

This document is the **author-declared** static review for the OMDSH Workshop
intake of `dsh-memento`. Every statement below comes from verifiable artifacts
in this repository or from recorded real executions. **Declarations carry no
verification authority** — Registry admission requires the Workshop's own
review and current-baseline evidence runs.

## Integration

- Mode: transactional profile bundle.
- Artifact: `package.json#dsh.bundle.patch` → `./cordis.patch.yml`
  (`- insert: - id: memento / name: dsh-memento`).
- Package: `dsh-memento` on npm (0.3.1 at the pinned commit).
- Official baseline: `@deepseek-ai/dsh@0.1.0-rc.6`.

## Permissions (declared)

- `network:none` — no network access in any code path.
- `subprocess:none`, `shell:none`, `python:none` — no child processes.
- `credentials:none` — no credential handling.
- `filesystem:read` / `filesystem:write` — scoped to the local memory database
  (default `<DSH_HOME or ~/.dsh>/dsh-memento/memory.db`, WAL, POSIX `0600`)
  plus a user-triggered `/memory import` file read (an explicit path the user
  types; not reachable from the model).
- `harness:tool` — registers the `memory` and `memory_recall` tools through
  the public `ctx.tools` service.
- No install scripts are declared (`installScriptsMustRemainDisabled: true`).

## Lifecycle (declared)

- Activation: at profile composition/start (`restart-profile`).
- Dispose: supported — all contributions are registered through `ctx.effect()`
  / service disposers; the SQLite store closes on unload. Verified by the
  "effect 撤回：dispose 后服务消失、库关闭" test.
- Failure policy: transactional; invalid configuration, corrupt database, or
  an unsupported schema version fails loudly at load, and `enabled:false`
  removes every contribution (no half-mounted state).

## Verification performed by the project (real, reproducible)

- 115 `node --test` cases: provider CRUD/match/audit/migrations, budget and
  gate policy, snapshot rendering, mock-ctx integration invariants (S2/S3),
  V2 command/recall/panel/import, coverage-report parser fixtures.
- `tsc -p tsconfig.check.json` (checkJs) clean.
- Coverage gate: `lib/*` ≥ 90 %, `index.mjs` ≥ 85 %, all files ≥ 90 %
  (last run: all files 96.92 %).
- Five-language README consistency gate (`node scripts/verify-readmes.mjs`).
- CI matrix green on ubuntu/macos/windows × Node 22.19/24 (2026-08-15).
- Real headless load with a real model turn on `@deepseek-ai/dsh@0.1.0-rc.6`
  (2026-08-15): scratch profile `memento-selfcheck` +
  `dsh --profile memento-selfcheck --patch selfcheck.patch.yml "hi"` completed
  with exit 0 and a real model reply; the run also shows the `node:sqlite`
  experimental warning, i.e. the provider store was loaded.

## Not yet performed (honest gaps)

- The Workshop harness-v2 sandbox adapters (`harness:profile`) have not run
  against this pinned commit; `evidence.failureIsolation`, `evidence.hotReload`,
  and `evidence.remove` are therefore declared `null` — they become non-null
  only when the Workshop review run produces the corresponding evidence files.
