<div align="center">

# dsh-memento

**Bounded, layered, approval-gated, auditable cross-session memory for DeepSeek Harness.**

*A typed `ctx.memory` seam, a write-approval gate no model path can bypass, and audit trails rebuilt from the session log.*

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
| Harness | DeepSeek Harness `0.1.0-rc.6` |
| Node | `^22.19.0 || >=24.0.0` |
| Platforms | Windows / macOS / Linux (pure host; no native code, no network) |
| Model | Any |

## What you get

`dsh-memento` is a capability seam, not another memory warehouse: a typed `ctx.memory` service, a local SQLite provider (`node:sqlite`, WAL, `0600`, at `$DSH_HOME/dsh-memento/memory.db`), and its consumers — the `memory` tool and a frozen snapshot injected into the system prompt.

- **The approval gate cannot be bypassed.** Every write path (`add` / `replace` / `remove` / `seed`) is forced through the approval waterfall inside the service, not in the tool layer. `writePolicy: ask | auto | off` is model-invisible configuration; `replace` / `remove` / `consolidate` carry the full text of the entries they change in the approval payload, and a denied write still lands a `*-denied` audit row.
- **Model-visible ⟺ logged.** The injected snapshot lands verbatim in `request/header.system`; every write is reconstructable from `approval/asked` + `approval/decided` + the plugin's own audit table.
- **Bounded and honest.** Hard per-track/per-layer character budgets (default user 2000 / agent 4000). A full store fails with a structured error (usage + limit) — never truncated, never auto-compacted.

Two tracks × two layers × per-agent key: a `user` track (facts about the user) and an `agent` track (environment facts and conventions), each split into `user-global` and `workspace` layers, isolated per `agentPreset`. The snapshot is frozen once per session at first prompt assembly and never changes mid-session.

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

- **git channel** (latest `main`): `dsh plugin --profile web add git+https://github.com/PerryLink/dsh-memento.git`.
- **npm channel** (published releases): `dsh plugin --profile web add dsh-memento`.
- **tarball channel**: `npm pack` in this repo, then `dsh plugin --profile web add ./dsh-memento-<version>.tgz`.
- **uninstall**: `dsh plugin --profile web remove dsh-memento` (the memory database and session logs are kept).

## Configuration

All tunables are Schemastery `Config` fields (changeable from cordis.yml). Invalid values fail loudly at load. Override under the `memento` row.

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch; `false` removes the service, tools, snapshot, command, panel, and answerer |
| `dbPath` | `''` → `$DSH_HOME/dsh-memento/memory.db` | Absolute, or relative to `$DSH_HOME` (falls back to `~/.dsh` on Windows) |
| `budgets.user.userGlobal` | `2000` | Hard character budget for the user track's user-global layer |
| `budgets.user.workspace` | `2000` | Hard character budget for the user track's workspace layer |
| `budgets.agent.userGlobal` | `4000` | Hard character budget for the agent track's user-global layer |
| `budgets.agent.workspace` | `4000` | Hard character budget for the agent track's workspace layer |
| `writePolicy` | `'ask'` | Default write policy: `ask` / `auto` / `off` (model-invisible) |
| `writePolicies` | `{}` | Per-track/scope or per-source overrides (e.g. `user/workspace`, `source:claude`) |
| `language` | `'en'` | Model-visible and command output language: `en` / `zh` |
| `snapshotOrder` | `-50` | Snapshot section order (after harness identity, before persona) |
| `maxEntriesPerQuery` | `20` | Default per-query result cap (hard-capped at 1000) |
| `commandListLimit` | `50` | Entries rendered per `/memory list` / `query` |
| `commandAuditLimit` | `10` | Audit rows rendered per `/memory audit` |
| `recall.historyLimitDefault` | `8` | `memory_recall` sessions scanned by default |
| `recall.snippetCap` | `5` | `memory_recall` snippets per session |
| `recall.snippetChars` | `300` | `memory_recall` snippet characters |
| `recall.windowDays` | `30` | `memory_recall` recency window in days |
| `panelEntriesLimit` | `200` | Web panel entries page size |
| `panelAuditLimit` | `20` | Web panel audit rows by default |
| `auditRetentionDays` | `0` | Audit retention (0 = keep forever) |
| `proposals.enabled` | `true` | Auto-capture a memory proposal after each successful compaction |
| `proposals.maxChars` | `2000` | Proposal character cap |
| `proposals.maxPending` | `8` | Pending proposal cap |

## Tools & surfaces

| Surface | Kind | Notes |
|---|---|---|
| `memory` | tool | add/replace/remove/consolidate/query with Save/Skip guidance; writes ride the approval gate |
| `memory_recall` | tool | Bounded memory matches plus recent session-history matches |
| `/memory` | command | `list` · `query` · `add` · `remove` · `consolidate` · `proposals` · `budgets` · `audit` · `export` · `import <path>` · `adapters` |
| web panel | client drawer | Read-only: browse entries, search, budget bars, audit tail |

## How it's different

| Plugin | What it is | dsh-memento's difference |
|---|---|---|
| dsh-memory-evolve | memory warehouse / evolution loops | a typed service seam, approval gate, and session-log audit; no warehouse ambition |
| dsh-mnemon | memory store helper | protocol + gate + audit, not another store |
| dsh-kb-sieve | knowledge-base sieving | no retrieval engineering: small-corpus substring search, cross-session recall via `session_search`/`sessionQuery` |
| dsh-tdai-memory | task-driven memory tooling | budgets are per track×layer and enforced in the service, not best-effort |
| claude-bridge | Claude Code bridging | DSH-native; a future `seed(source:'claude')` path lets a bridge feed the same store |
| dsh-external/Recall | external agent memory | local-first, zero-network, rides DSH's own approval seam |
| Official MCP memory examples | DSH's stated "memory = external MCP" position | the **native first-party** complement: same goal, no external server; both coexist |

The name is **`dsh-memento`** (published on npm and GitHub). Not `dsh-recall` (confusable with dsh-external/Recall), not the deleted legacy name `dsh-memory`.

## dsh-memory-protocol v1

`dsh-memento` is the community rehearsal of the DSH memory protocol — a candidate shape for an official `ctx.memory` seam. The protocol normalizes this plugin's seam into a cross-plugin contract:

- **Entry spec** — two tracks × two layers × per-agent key, plus short `tags` (≤16 × ≤32 chars) and a per-entry `version` that increments on every `replace`.
- **Write semantics** — idempotent unique-substring conditional writes; approve-what-you-see payloads (`replace` / `remove` / `consolidate` carry the full text they change).
- **Audit contract** — every write reconstructable from `approval/asked` + `approval/decided` + the provider ledger.
- **Budget model** — `BUDGET_EXCEEDED` / `AMBIGUOUS_MATCH` semantics.
- **Schema versioning** — migration rules with loud version checks.

- **Spec** — [docs/protocol-v1.md](docs/protocol-v1.md) (中文: [protocol-v1.zh.md](docs/protocol-v1.zh.md)); normative JSON Schema at [docs/schemas/dsh-memory-protocol-v1.schema.json](docs/schemas/dsh-memory-protocol-v1.schema.json).

**Adapter registry** — `ctx.memoryAdapters` (`register` / `list` / `adapt` / `export`) lets third-party memory plugins speak the protocol by registering a pure data converter (reversible `register()`; import rides the approval-gated `seed`, export is read-only). Onboarding: [docs/adapters-guide.md](docs/adapters-guide.md) (中文: [adapters-guide.zh.md](docs/adapters-guide.zh.md)).

| Built-in adapter | External format | Notes |
|---|---|---|
| `mem0` | mem0 fact collections (`{facts: [{memory, metadata?}]}`) | `metadata.category` / `metadata.tags` become tags; raw `messages` arrays are rejected — adapters convert, never extract |
| `hermes-memory-md` | Hermes `memory.md` (`## section` + bullets) | section names become tags; non-bullet prose fails loudly |
| `claude-code-memory-md` | `CLAUDE.md`-style markdown (headings, bullets, paragraphs) | bullets and paragraphs become entries; section names become tags |

**Conformance suite** — [test/protocol-conformance/](test/protocol-conformance/README.md): a distributable case set any provider claiming compatibility runs (`node test/protocol-conformance/run.mjs --provider ./your-factory.mjs`); this repo's CI runs it against its own provider as the golden reference (`npm run test:conformance`).

- **Upstream proposal** — [docs/upstream-proposal.md](docs/upstream-proposal.md) (中文: [upstream-proposal.zh.md](docs/upstream-proposal.zh.md)): why the official `ctx.memory` seam should adopt the protocol, the differences, and the migration path.

## Permissions & data

- **Permissions**: declares `harness:tool`, `filesystem:read`, `filesystem:write`, and `network:none` / `subprocess:none` / `shell:none` / `python:none` / `credentials:none` in its workshop manifest. Write approval rides the official approval seam.
- **Data**: local SQLite database (`0600`), zero network, zero credentials.
- **Session log**: audit completeness comes from the approval pair (`approval/asked` + `approval/decided`) plus the plugin's own audit table.

## Security boundaries

- **Public services only.** Consumes `tools`, `systemPrompt`, and the approval seam; no engine / agent-loop / apiproxy / official-UI changes.
- **Zero network, zero credentials.** Local database with POSIX file mode `0600`.
- **Fail loud.** Corrupt DB, newer schema, or invalid config fails at load; full budgets and ambiguous substring matches fail with structured errors.
- **One process, one store.** Multiple sessions share the SQLite store; two processes sharing one `$DSH_HOME` write the same file (last-writer-wins under SQLite locking).

## Known limitations

- **Session events are declared, not yet emitted (rc.6).** `memory/added|updated|removed|recalled|snapshot` are merge-declared, but rc.6 has no registration surface for out-of-repo event types; emission turns on once a harness build registers them.
- **`ask` policy needs an answerer.** With no UI/ACP answerer composed, writes fail closed.
- **No FTS5 indexing.** Substring search runs on case-insensitive `instr` (correct for CJK).

## What we learned from the terminal memories

`dsh-memento` is not a port of Claude Code, Codex, or Hermes — but its design deliberately absorbed the parts each got right, and refused the parts that hurt:

| Terminal memory | What it got right | What dsh-memento adopted |
|---|---|---|
| **Claude Code** — `CLAUDE.md` | hierarchical plain-text memory files (user-level → project-level), human-readable and human-editable, merged automatically into every session | plain-text entries; `user-global` / `workspace` layers merged per session; a store you can browse, `export`, and audit — transparency as a feature |
| **Codex** — `AGENTS.md` | per-directory scoped instructions auto-discovered and injected with zero model friction | the `workspace` layer keyed by the session cwd (Windows case-insensitive); the frozen snapshot injected automatically at session start |
| **Hermes** — `memory.md` | proactive memory saves and the security lesson that a gate enforced only in the tool layer is bypassable by late tool injection | the `memory` tool with Save/Skip guidance + approval-gated auto-capture proposals; the gate lives inside `ctx.memory`'s write methods, not in the tool layer |

Sources: [Claude Code memory](https://code.claude.com/docs/en/memory) · [Codex AGENTS.md](https://developers.openai.com/codex/cli/agents-md) · [Hermes memory](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md) · [Hermes #48181](https://github.com/NousResearch/hermes-agent/issues/48181).

And the parts deliberately refused: hidden auto-summarization into model-private state (compaction summaries here become **pending proposals** that wait for a human approve/dismiss), warehouse/vector-store ambitions, and any write that lacks a human-visible approval or audit trail. Also adopted: Hermes's documented caveat that two processes sharing one home directory write the same memory file — see Security boundaries.

## Development

```sh
npm install              # node ^22.19 || >=24
npm test                 # node --test: 133 tests
npm run test:conformance # dsh-memory-protocol v1 conformance suite
npm run typecheck        # tsc --checkJs gate
npm run check:coverage   # line-coverage gate
npm run check:readmes    # five-language README consistency gate
```

`lib/` is zero-DSH-dependency (node: builtins only); DSH imports exist only in `index.mjs`.

## Topics

`dsh`, `dsh-plugin`, `deepseek-harness`, `memory`, `agent-memory`, `approval`, `audit`, `sqlite`, `cordis`, `llm`

## Contributors

- [@Niuniu-Sir](https://github.com/Niuniu-Sir) — the boot-crash report in [issue #1](https://github.com/PerryLink/dsh-memento/issues/1) that led to the `~/.dsh` fallback shipped in 0.3.1.

## PerryLink DSH Plugin Family

This project is one of the [15 DeepSeek Harness plugins](https://github.com/PerryLink) maintained by [PerryLink](https://github.com/PerryLink). If this one helps you, the others likely will too:

| Plugin | One-liner |
|---|---|
| [dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel) | Read-only MCP runtime panel: /mcp command + Settings tab with status, tools and errors |
| [dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck) | Engineering-discipline guard: requirements grill, test gates, adversary review |
| [dsh-background-agents](https://github.com/PerryLink/dsh-background-agents) | Durable background child agents with a Web UI sidebar, messaging and interrupt |
| [dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions) | LSP diagnostics, formatting, completion, code actions and rename over language servers |
| [dsh-output-styles](https://github.com/PerryLink/dsh-output-styles) | Claude Code outputStyles-equivalent runtime style switching |
| [dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind) | Claude Code /rewind-equivalent: snapshots, session forks, one-shot restore |
| [dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules) | Claude Code-style declarative allow/deny/ask permission rules with audit |
| [dsh-auto-review](https://github.com/PerryLink/dsh-auto-review) | Second-model auto-review on the approval chain, fail-closed by default |
| **[dsh-memento](https://github.com/PerryLink/dsh-memento)** | Approval-gated cross-session memory: ctx.memory seam + SQLite + memory tool |
| [dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security) | Security-audit skill pack: secret scan, dependency and supply-chain review |
| [dsh-session-pin](https://github.com/PerryLink/dsh-session-pin) | Pin sessions in the Web sidebar with durable ordering |
| [dsh-composer-history](https://github.com/PerryLink/dsh-composer-history) | Terminal-style input history for the web composer: arrows, Ctrl+R search |
| [dsh-github](https://github.com/PerryLink/dsh-github) | GitHub PR/issues integration for DSH, every write gated by approval |
| [dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide) | Plugin-development knowledge base as an on-demand agent skill |
| [dsh-claude-move](https://github.com/PerryLink/dsh-claude-move) | Migrate Claude Code sessions, memory, skills and CLAUDE.md into DSH |

## License

[Apache License 2.0](LICENSE) © 2026 dsh-memento contributors
