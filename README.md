# dsh-memento

**Bounded, layered, approval-gated, auditable cross-session memory for DeepSeek Harness.**

[![license](https://img.shields.io/badge/license-Apache--2.0-3a7d44)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-0.1.0--rc.6-4e51e8)](https://www.npmjs.com/package/@deepseek-ai/dsh)
[![node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-339933)](https://nodejs.org/)
[![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)]()
[![no build step](https://img.shields.io/badge/build-none%20%28pure%20ESM%29-8a6d3b)]()

[English](README.md) · [中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

> Other memory plugins sell a **warehouse**. dsh-memento sells the **seam**: a typed `ctx.memory` service, a write approval gate no model path can bypass, and audit trails you can rebuild from the session log. Native-first memory for DeepSeek Harness — protocol + trust gate + audit, with zero network and zero credentials.

## ✨ Why dsh-memento?

- **It's a capability seam, not another store.** Service Definition (`ctx.memory`), local SQLite Provider (`node:sqlite`, WAL, `0600`), and Consumers (`memory` tool + frozen snapshot injection). Any future plugin — a `dsh-claude-move` seed integration, a bridge, a panel — feeds and reads the **same store through the same gate**.
- **The gate cannot be bypassed.** Every write path (`add`/`replace`/`remove`/`seed`) is forced through the approval waterfall **inside the service**, not in the tool layer. `writePolicy: ask | auto | off` is configuration the model can neither see nor change; a session-level `never` stance still pre-empts everything.
- **Model-visible ⟺ logged.** The injected snapshot lands verbatim in `request/header.system`; every write is reconstructable from `approval/asked` (full payload) + `approval/decided` (outcome) + the plugin's own audit table.
- **Bounded and honest.** Hard per-track/per-layer character budgets (default user 2000 / agent 4000). A full store **fails with a structured error** (usage + limit) — the model consolidates and retries. Never truncated, never auto-compacted.

## ⚡ Quick start

```sh
# requires Node ^22.19 || >=24 and DSH 0.1.0-rc.6
dsh plugin --profile web add dsh-memento      # or ./dsh-memento / a tarball / a GitHub URL
dsh --profile web --dump-config               # expect a "# == dsh-memento" layer, no FAILED at startup
```

Then, in the Web UI: ask the model to remember something → approve the write → start a **new session** and ask what it remembers. That's the whole demo.

```yaml
# optional override in the profile's cordis.patch.yml
- id: memento
  config:
    writePolicy: ask        # ask (default) | auto | off — model-invisible
    budgets:
      user: { userGlobal: 4000, workspace: 2000 }   # Chinese-heavy memory: raise + note why
      agent: { userGlobal: 4000, workspace: 4000 }
```

## 🧠 What it does

| | Component | What you get |
| --- | --- | --- |
| 🧩 Service Definition | `ctx.memory` — `add` / `replace` / `remove` / `query` / `seed` / `budgets()` | Typed, merge-declared service; write methods enforce the gate internally |
| 💾 Provider | `lib/store.mjs` — `node:sqlite` single file (`$DSH_HOME/dsh-memento/memory.db`, WAL) | Zero dependencies, zero network; entry + audit tables; unique-substring match |
| 🛠 Consumers | `memory` tool · frozen snapshot injection (system-prompt section, order `-50`) · `memory_recall` tool · `/memory` command · read-only Web panel | Model-facing writes/reads, budget-headed frozen snapshot, two-part recall, user-side command, browser drawer |

**Two tracks × two layers.** `user` track = facts about the user (preferences, communication style, landmines); `agent` track = environment facts, project conventions, lessons learned. Each track has `user-global` (cross-workspace) and `workspace` (per-session cwd) layers — Codex-style merged layering, not Hermes-style global-only.

**Frozen snapshots.** The snapshot is rendered once per session at first prompt assembly (synchronous SQLite read + per-session cache) and never changes mid-session — prefix-cache stable by construction. Session-internal changes persist to disk + audit only.

```
Consumer: memory tool          Consumer: frozen snapshot (systemPrompt section, order -50)
   add/replace/remove/query       per-session freeze, budget-headed
        │ writes (agent+callId)   │ reads (sync, session cwd)
        ▼                          ▼
Service Definition: ctx.memory — budgets/add/replace/remove/query/seed
   every write: budget precheck → ctx.approval.request (approval waterfall) → budget recheck → persist → audit
        │
        ▼
Provider: lib/store.mjs — node:sqlite (WAL, 0600), entries + audit tables, unique-substring match
```

## 🧰 Install & uninstall

```sh
dsh plugin --profile <name> add ./dsh-memento        # local checkout (no build step)
dsh plugin --profile <name> add dsh-memento          # npm, once published
dsh plugin --profile <name> remove dsh-memento       # uninstall: DB + session logs are kept
```

After uninstall the memory database and the session logs that recorded memory activity remain; old sessions stay loadable.

## ⚙️ Configuration

Every field is a validated Schemastery `Config`; invalid values fail loudly at load. Override in cordis.yml under the `memento` row.

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | `false` removes the service, tools, snapshot, command, panel, and answerer entirely (no half-state) |
| `dbPath` | `''` → `$DSH_HOME/dsh-memento/memory.db` | absolute, or relative to `$DSH_HOME` |
| `budgets.user.userGlobal` / `budgets.user.workspace` | `2000` / `2000` | hard char budget per layer of the user track |
| `budgets.agent.userGlobal` / `budgets.agent.workspace` | `4000` / `4000` | hard char budget per layer of the agent track |
| `writePolicy` | `'ask'` | `'ask'` = user approval; `'auto'` = allow through (approval source recorded); `'off'` = reject. Model-invisible |
| `snapshotOrder` | `-50` | snapshot section order: after harness identity (`-100`), before persona (`0`) |
| `maxEntriesPerQuery` | `20` | per-query result cap |

## 🛠 Tools & surfaces

- **`memory`** — add/replace/remove/query with Save/Skip guidance embedded in the description (save user preferences, corrections, environment facts, conventions, lessons; skip trivia, re-derivable facts, dumps, one-off paths). Writes ride the approval gate; reads are free; replace/remove target a **unique substring** (ambiguous matches fail with the candidate list).
- **`memory_recall`** — two-part recall: bounded memory matches **plus** recent session-history matches via `ctx.sessionQuery` (degrades gracefully to memory-only where the service is absent).
- **`/memory`** — user-triggered command (not a model turn): `list` · `query <word>` · `add [--track=user|agent] [--scope=user-global|workspace] <text>` · `remove [flags] <substring>` · `budgets` · `audit`. Command writes ride the same waterfall + policy; audit lands in the plugin audit table + `command/done`.
- **Web panel** — zero-build `dsh.client` drawer: browse entries by track/layer, search, budget bars, audit tail. Read-only by design: writes and approval happen through the `memory` tool and the built-in approval UI.

## 🆚 How it's different

| Plugin | What it is | dsh-memento's difference |
| --- | --- | --- |
| dsh-memory-evolve | memory warehouse / evolution loops | a typed service seam, approval gate, and session-log audit; no warehouse ambition |
| dsh-mnemon | memory store helper | protocol + gate + audit, not another store |
| dsh-kb-sieve | knowledge-base sieving | no retrieval engineering: small-corpus substring search, cross-session recall via `session_search`/`sessionQuery` |
| dsh-tdai-memory | task-driven memory tooling | budgets are per track×layer and enforced in the service, not best-effort |
| claude-bridge | Claude Code bridging | DSH-native; a future `seed(source:'claude')` path lets a bridge feed the same store |
| dsh-external/Recall | external agent memory | local-first, zero-network, rides DSH's own approval seam |
| Official MCP memory examples | DSH's stated "memory = external MCP" position | the **native first-party** complement: same goal, no external server; both coexist |

The name is **`dsh-memento`** (free on npm and GitHub). Not `dsh-recall` (confusable with dsh-external/Recall), not the deleted legacy name `dsh-memory`.

## 🔒 Security boundaries

- **Public services only** (`tools`, `systemPrompt`, the approval seam). No engine / agent-loop / apiproxy / official-UI changes.
- **Zero network, zero credentials.** Local database; POSIX file mode `0600`.
- **Fail loud.** Corrupt DB or newer schema fails at load; full budgets and ambiguous substring matches fail with structured errors. Nothing silently swallowed or truncated.
- **One process, one store.** Multiple sessions in one process share the SQLite store (serialized writes, per-session audit). Two **processes** sharing one `$DSH_HOME` write the same file: last-writer-wins under SQLite locking — don't run two harness instances on one `$DSH_HOME` if you need cross-process consistency (same caveat the Hermes project documents).

## ⚠️ Known limitations

- **Session events vocabulary is declared, not yet emitted (rc.6).** `memory/added|updated|removed|recalled|snapshot` are merge-declared in `types.d.ts`, but rc.6 has no registration surface for out-of-repo event types (unregistered appends would make persisted sessions unloadable). Audit completeness comes from the approval pair + the audit table; emission turns on automatically once a harness build registers the types. See [ARCHITECTURE.md](ARCHITECTURE.md) decision 4.
- **`ask` policy needs an answerer.** With no UI/ACP answerer composed, writes fail closed (`unavailable`) — by design, the approval seam's fail-closed stance.
- **No per-agent scope yet.** V1 layers are `user-global` and `workspace` only.

## 🧪 Development

```sh
npm install
npm test    # node --test: 66 tests — budget, unique-substring, gate policy, store, snapshot, mock-ctx integration (S2/S3 invariants), V2 command/recall/panel
```

`lib/` is zero-DSH-dependency (node: builtins only); DSH imports exist only in `index.mjs`. Full discipline in [AGENTS.md](AGENTS.md); design decisions in [ARCHITECTURE.md](ARCHITECTURE.md).

## 🏷 Topics

Suggested GitHub topics: `dsh` · `dsh-plugin` · `deepseek-harness` · `memory` · `agent-memory` · `approval` · `audit` · `sqlite` · `cordis` · `llm`

## 📄 License

Apache License 2.0 — see [LICENSE](LICENSE). No third-party code is redistributed; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
