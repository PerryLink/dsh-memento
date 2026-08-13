# dsh-memento

**Bounded, layered, approval-gated, auditable cross-session memory for DeepSeek Harness.**

[中文文档](README.zh.md) · [架构与设计决策](ARCHITECTURE.md)

Other memory plugins sell a *warehouse*. dsh-memento sells a **capability seam**: a typed `ctx.memory` service, a write approval gate the model cannot bypass, and audit trails reconstructable from the session log. It is a native first-party memory layer for DSH — the *protocol + trust gate + audit*, not another store you must babysit.

## What it does

| Role | Component | What you get |
| --- | --- | --- |
| Service Definition | `ctx.memory` — `add` / `replace` / `remove` / `query` / `seed` / `budgets()` | Any plugin (e.g. a future `dsh-claude-move` integration) feeds and reads the **same** store through the **same** gate |
| Provider | local SQLite via `node:sqlite` (`$DSH_HOME/dsh-memento/memory.db`, WAL, 0600) | Zero dependencies, zero network, zero credentials |
| Consumer | `memory` tool + frozen snapshot injection (system-prompt section, order `-50`) | The model reads/writes memory; every session starts with a budget-headed, frozen snapshot |

- **Two tracks, two layers.** `user` track = facts about the user (preferences, style, landmines); `agent` track = environment facts, conventions, lessons. Each track has `user-global` (cross-workspace) and `workspace` (per-session cwd) layers — Codex-style merged layering, not Hermes-style global-only.
- **Hard character budgets per track per layer** (default user 2000 / agent 4000, Chinese-friendly counting: 1 char = 1). A full store **fails loudly** with a structured error (current usage + limit) — the model consolidates and retries. Never truncated, never auto-compacted.
- **Writes default to approval (`writePolicy: 'ask'`).** The gate lives **inside the service methods** (approval waterfall), not in the tool layer: no tool, plugin, or indirect path can write memory without passing the approval seam. `'auto'` allows through while recording the approval source; `'off'` rejects. The model cannot see or change `writePolicy`.
- **Model-visible ⟺ logged.** Every write is reconstructable from the session log (`approval/asked` carries the full payload, `approval/decided` the outcome); the injected snapshot text lands verbatim in `request/header.system` and in the plugin's `audit` table.
- **Frozen snapshots.** The snapshot is rendered once per session at first prompt assembly and never changes mid-session — prefix-cache stable by construction. Session-internal changes persist to disk + audit only.

```
Consumer: memory tool          Consumer: frozen snapshot (systemPrompt section, order -50)
   add/replace/remove/query       per-session freeze (WeakMap), budget-headed
        │ writes (agent+callId)   │ reads (sync, session cwd)
        ▼                          ▼
Service Definition: ctx.memory — budgets/add/replace/remove/query/seed
   every write: budget precheck → ctx.approval.request (approval waterfall) → budget recheck → persist → audit
        │
        ▼
Provider: lib/store.mjs — node:sqlite (WAL, 0600), entries + audit tables, unique-substring match
```

## Positioning: why another memory plugin?

| Plugin | What it is | dsh-memento's difference |
| --- | --- | --- |
| dsh-memory-evolve | memory warehouse / evolution loops | memento adds a typed service seam, approval gate, and session-log audit; no warehouse ambition |
| dsh-mnemon | memory store helper | same — memento is a protocol + gate + audit, not another store |
| dsh-kb-sieve | knowledge-base sieving | memento does no retrieval engineering: small-corpus substring search, cross-session recall via the built-in `session_search` |
| dsh-tdai-memory | task-driven memory tooling | memento's budgets are per track×layer and enforced in the service, not best-effort |
| claude-bridge | Claude Code bridging | memento is DSH-native; a future `seed(source:'claude')` path lets a bridge feed the same store |
| dsh-external/Recall | external agent memory | memento is local-first, zero-network, and rides DSH's own approval seam |
| Official MCP memory examples (`examples/mcp-memory`) | DSH's stated "memory = external MCP" position | memento is the **native first-party** complement: same goal, no external server, but both coexist — memento does not replace MCP-based stores and vice versa |

The name is **`dsh-memento`** (free on npm and GitHub). Do not use `dsh-recall` (confusable with dsh-external/Recall) or the deleted legacy name `dsh-memory`.

## Install

Requires Node `^22.19 || >=24` and DSH `0.1.0-rc.6` (web profile). No build step — `index.mjs` + `lib/` are the shipped artifacts.

```sh
# local checkout (or a packed tarball / npm / GitHub URL)
dsh plugin --profile <name> add ./dsh-memento
dsh --profile <name> --dump-config   # expect a "# == dsh-memento" layer, no FAILED at startup
```

Uninstall:

```sh
dsh plugin --profile <name> remove dsh-memento
```

The memory database and the session logs that recorded memory activity are **kept** after uninstall; old sessions stay loadable.

## Configuration

Every field is a validated `Config` (Schemastery), overridable in cordis.yml under the `memento` row. Invalid values fail at load, loudly.

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | `false` removes the service, tool, snapshot, and approval answerer entirely (no half-state) |
| `dbPath` | `''` → `$DSH_HOME/dsh-memento/memory.db` | absolute path, or relative to `$DSH_HOME` |
| `budgets.user.userGlobal` / `budgets.user.workspace` | `2000` / `2000` | hard char budget per layer of the user track |
| `budgets.agent.userGlobal` / `budgets.agent.workspace` | `4000` / `4000` | hard char budget per layer of the agent track |
| `writePolicy` | `'ask'` | `'ask'` = user approval; `'auto'` = allow through (approval source recorded); `'off'` = reject. Model-invisible |
| `snapshotOrder` | `-50` | snapshot section order: after harness identity (`-100`), before persona (`0`) |
| `maxEntriesPerQuery` | `20` | per-query result cap |

Example (profile `cordis.patch.yml`):

```yaml
- insert:
    - id: memento
      name: dsh-memento
      config:
        writePolicy: auto
        budgets:
          user: { userGlobal: 4000, workspace: 2000 }   # Chinese-heavy memory: raise the budget with a PR note
          agent: { userGlobal: 4000, workspace: 4000 }
```

## Using it

- Ask the model to remember something → it calls the `memory` tool → approval (under `ask`) → `approval/asked` + `approval/decided` hit the session log → the entry lands in the store.
- Next session in the same workspace starts with the frozen snapshot (budget-headed). Ask "what do you remember about me?" — the snapshot answers; historical recall uses the built-in `session_search` tool (memento does not reimplement search).
- Writes that exceed a budget return a structured error with usage and limit; the model removes/consolidates entries and retries.
- Anything that reaches the model is reconstructable from the session log: `request/header.system` (snapshot text), `approval/asked` (full write payload), `tool/call` + `tool/result` (canonical outcomes), plus the `audit` table in the database.

## Observation surfaces (V2)

- **`/memory` command** (user-triggered, outside model turns): `list` · `query <word>` · `add [--track=user|agent] [--scope=user-global|workspace] <text>` · `remove [flags] <unique substring>` · `budgets` · `audit`. Command writes ride the same approval waterfall + `writePolicy` (session-level `never` still pre-empts); audit lands in the plugin audit table + `command/done` (the approval service's turn-enclosed audit pair cannot exist outside a turn — see [ARCHITECTURE.md](ARCHITECTURE.md) decision 8).
- **`memory_recall` tool**: two-part recall — bounded memory matches plus recent session-history matches via `ctx.sessionQuery` (degrades to memory-only where the service is absent).
- **Web panel** (zero-build `dsh.client` drawer): browse entries by track/layer, search, budget bars, audit tail. Read-only by design: writes and approval happen through the `memory` tool and the built-in approval UI.

## Security boundaries

- **Public services only** (`tools`, `systemPrompt`, the approval seam). No engine / agent-loop / apiproxy / official-UI changes.
- **Zero network, zero credentials.** The database is local; POSIX file mode `0600`.
- **Fail loud.** Corrupt database or a newer schema version fails at load; full budgets and ambiguous substring matches fail with structured errors. Nothing is ever silently swallowed or truncated.
- **One process, one store.** Multiple sessions in one process share the SQLite store (serialized writes, per-session audit). Two **processes** sharing one `$DSH_HOME` write to the same file: last-writer-wins with SQLite locking — do not run two harness instances on one `$DSH_HOME` if you need cross-process consistency (same caveat the Hermes project documents).
- **rc.6 note on session events.** The `memory/added|updated|removed|recalled|snapshot` event vocabulary is declared (types.d.ts) but not appended to session logs until a harness build registers those event types — appending unregistered types would make persisted sessions unloadable. Audit completeness on rc.6 comes from the approval pair + the audit table (see [ARCHITECTURE.md](ARCHITECTURE.md) decision 4).

## Development

```sh
npm install
npm test    # node --test: 62 tests — budget, unique-substring, gate policy, store, snapshot, mock-ctx integration (S2/S3 invariants), V2 command/recall/panel
```

`lib/` is zero-DSH-dependency (node: builtins only); DSH imports exist only in `index.mjs`. See [AGENTS.md](AGENTS.md) for the full discipline.

## License

MIT — see [LICENSE](LICENSE). No third-party code is redistributed; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
