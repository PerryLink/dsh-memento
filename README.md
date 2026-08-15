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
- **The gate cannot be bypassed.** Every write path (`add`/`replace`/`remove`/`seed`) is forced through the approval waterfall **inside the service**, not in the tool layer. `writePolicy: ask | auto | off` is configuration the model can neither see nor change; a session-level `never` stance still pre-empts everything. `replace`/`remove`/`consolidate` carry the full text of the entries they will change in the approval payload — what you approve is what you see, and a denied write still lands a `*-denied` audit row.
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

**Two tracks × two layers × per-agent key.** `user` track = facts about the user (preferences, communication style, landmines); `agent` track = environment facts, project conventions, lessons learned. Each track has `user-global` (cross-workspace) and `workspace` (per-session cwd) layers — Codex-style merged layering, not Hermes-style global-only. A third dimension isolates entries by the session's `agentPreset` (per-agent scope); entries without a preset stay in the shared layer visible to everyone. Session-scoped reads and write targeting follow the same visibility: a session sees — and `replace`/`remove` can only touch — shared entries plus its own agent's entries, and `workspace` entries only for its own cwd. The management surfaces (`/memory`, the panel) keep the full cross-agent view.

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
dsh plugin --profile <name> add git+https://github.com/PerryLink/dsh-memento.git   # GitHub install; npm after first release
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
| `writePolicies` | `{}` | per-track/scope or per-source overrides: keys `user/workspace`, `agent/user-global`, `source:claude`, … → `ask`/`auto`/`off`; unmatched falls back to `writePolicy` |
| `language` | `'en'` | model-visible text and command output language: `'en'` (default) or `'zh'` — tool descriptions, frozen snapshot, `/memory` command, and web panel all follow it |
| `snapshotOrder` | `-50` | snapshot section order: after harness identity (`-100`), before persona (`0`) |
| `maxEntriesPerQuery` | `20` | default per-query result cap (explicit `limit` allowed, hard-capped at 1000) |
| `commandListLimit` | `50` | entries rendered per `/memory list` / `query` command |
| `commandAuditLimit` | `10` | audit rows rendered per `/memory audit` command |
| `recall.historyLimitDefault` / `recall.snippetCap` / `recall.snippetChars` / `recall.windowDays` | `8` / `5` / `300` / `30` | `memory_recall` history defaults: sessions scanned, snippets per session, snippet chars, recency window in days |
| `panelEntriesLimit` | `200` | web panel entries page size (and clamp) |
| `panelAuditLimit` | `20` | web panel audit rows by default (ceiling 200) |
| `auditRetentionDays` | `0` | audit retention: 0 = keep forever, >0 = prune rows older than N days at store open |
| `proposals.enabled` / `proposals.maxChars` / `proposals.maxPending` | `true` / `2000` / `8` | auto-capture: pending memory proposal after each successful compaction (truncated, one per session); disable or tune caps |

## 🛠 Tools & surfaces

- **`memory`** — add/replace/remove/consolidate/query with Save/Skip guidance embedded in the description (save user preferences, corrections, environment facts, conventions, lessons; skip trivia, re-derivable facts, dumps, one-off paths). Writes ride the approval gate; reads are free; replace/remove target a **unique substring** (ambiguous matches fail with the candidate list); consolidate merges 1..20 entries into one with a single approval and one atomic write.
- **`memory_recall`** — two-part recall: bounded memory matches **plus** recent session-history matches via `ctx.sessionQuery` (degrades gracefully to memory-only where the service is absent).
- **`/memory`** — user-triggered command (not a model turn): `list` · `query <word>` · `add [--track=user|agent] [--scope=user-global|workspace] <text>` · `remove [flags] <substring>` · `consolidate [flags] <substring...> => <text>` · `proposals [approve|dismiss <id>]` · `budgets` · `audit` · `export`. Command writes ride the same waterfall + policy; audit lands in the plugin audit table + `command/done`. `export` is read-only and dumps all entries + budgets as one JSON document (backup / migration).
- **Auto-capture proposals** — after a successful session compaction, the summary lands as a pending memory proposal (`agent/workspace`); approving writes it through the approval gate, dismissing drops it. Pending proposals appear in the frozen snapshot and the panel.
- **Web panel** — zero-build `dsh.client` drawer: browse entries by track/layer, search, budget bars, audit tail. Read-only by design: writes and approval happen through the `memory` tool and the built-in approval UI.

## 🎓 What we learned from the terminal memories

dsh-memento is not a port of Claude Code, Codex, or Hermes — but its design deliberately absorbed the parts each of them got right, and refused the parts that hurt:

| Terminal memory | What it got right | What dsh-memento adopted |
| --- | --- | --- |
| **Claude Code** — `CLAUDE.md` | hierarchical **plain-text memory files** (user-level → project-level) that are human-readable, human-editable, and merged automatically into every session — memory you can read and fix yourself | plain-text entries; `user-global` / `workspace` layers merged per session; a store you can browse, `export`, and audit — transparency as a feature |
| **Codex** — `AGENTS.md` | **per-directory scoped instructions** auto-discovered and injected with zero model friction — locality beats volume, no tool call needed to "load" memory | `workspace` layer keyed by the session's cwd (Windows case-insensitive); the frozen snapshot is injected automatically at session start |
| **Hermes** — `memory.md` | **proactive memory saves** (save/update/delete) and, in [issue #48181](https://github.com/NousResearch/hermes-agent/issues/48181), the security lesson that a gate enforced only in the tool layer is bypassable by late tool injection — enforce it where every write path meets | the `memory` tool with explicit Save/Skip guidance + approval-gated auto-capture proposals; the approval gate lives **inside** `ctx.memory`'s write methods, not in the tool layer |

Sources: [Claude Code memory](https://code.claude.com/docs/en/memory) · [Codex AGENTS.md](https://developers.openai.com/codex/cli/agents-md) · [Hermes memory](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md) · [Hermes #48181](https://github.com/NousResearch/hermes-agent/issues/48181).

And the parts we deliberately refused: hidden auto-summarization into model-private state (compaction summaries here become **pending proposals** that wait for a human approve/dismiss), warehouse/vector-store ambitions, and any write that lacks a human-visible approval or audit trail. Also adopted: Hermes's documented caveat that two processes sharing one home directory write the same memory file — see Security boundaries.

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
- **No FTS5 indexing.** Substring search runs on case-insensitive `instr` (correct for CJK); recall ranking uses per-entry hit counts. FTS5's trigram tokenizer cannot index single-character CJK tokens, so it is not used — see [ARCHITECTURE.md](ARCHITECTURE.md) decision 10.

## 🧪 Development

```sh
npm install
npm test                # node --test: 103 tests — budget, unique-substring, gate policy, store, snapshot, mock-ctx integration (S2/S3 invariants), V2 command/recall/panel
npm run typecheck       # tsc --checkJs gate over index.mjs / lib / scripts
npm run check:coverage  # line-coverage gate: lib ≥90%, index.mjs ≥85%, all files ≥90%
npm run check:readmes   # five-language README consistency gate
```

`lib/` is zero-DSH-dependency (node: builtins only); DSH imports exist only in `index.mjs`. Full discipline in [AGENTS.md](AGENTS.md); design decisions in [ARCHITECTURE.md](ARCHITECTURE.md).

## 🏷 Topics

Suggested GitHub topics: `dsh` · `dsh-plugin` · `deepseek-harness` · `memory` · `agent-memory` · `approval` · `audit` · `sqlite` · `cordis` · `llm`

## 📄 License

Apache License 2.0 — see [LICENSE](LICENSE). No third-party code is redistributed; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
