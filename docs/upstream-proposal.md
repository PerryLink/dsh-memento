# Upstream proposal: adopt dsh-memory-protocol v1 as the official `ctx.memory` seam

> 中文版见 [upstream-proposal.zh.md](upstream-proposal.zh.md)。Protocol spec:
> [protocol-v1.md](protocol-v1.md)。

This document makes the case that the official DeepSeek Harness `ctx.memory` seam should adopt
**`dsh-memory-protocol/v1`** — the protocol dsh-memento rehearses in the community — and lists
the concrete differences and migration path. It is written for harness maintainers.

## Why the seam should adopt this protocol

**1. The write gate is enforced where every write path meets — inside the service.**
The official seam today has no memory service; memory plugins are expected to bring their own
stores, and a gate enforced in a tool layer is bypassable by late tool injection (the failure
mode Hermes documented in [issue #48181](https://github.com/NousResearch/hermes-agent/issues/48181)).
The protocol pins the enforcement point: *every* write (`add`/`replace`/`remove`/`consolidate`/
`seed`) rides an approval transport inside the provider, `writePolicy` is configuration the
model can neither see nor change, and a session-level `never` stance pre-empts everything.

**2. Model-visible ⟺ reconstructable, by construction.**
Approval payloads carry the complete change (approve-what-you-see: full old text, full new text,
per-target excerpts for consolidation); every allowed write lands an audit row naming the real
decision source; every denied write lands a `<action>-denied` row before the error propagates.
Together with the harness's own `approval/asked` + `approval/decided` pair, any state change is
rebuildable from the session log — the same invariant the harness already applies to its own
model-visible surfaces.

**3. Local-first, zero network, zero credentials.**
The reference provider is one local SQLite file (`0600`, WAL) with a monotonic schema version
and loud failures (`STORE_CORRUPT` / `STORE_UNSUPPORTED_VERSION`). The official seam would
inherit "memory stays on the user's machine" as a first-class property rather than a per-plugin
hope.

**4. Bounded and honest budgets.**
Hard per-track/per-layer character budgets with structured `BUDGET_EXCEEDED` errors (usage +
limit + needed) give the model a deterministic consolidate-and-retry loop. No silent truncation,
no hidden auto-compaction — both of which are otherwise attractive and dangerous shortcuts.

**5. One conformance suite for a whole ecosystem.**
`test/protocol-conformance/` is a distributable case set: any provider claiming compatibility
runs the same cases dsh-memento's own provider runs in CI. Adopting the protocol turns the
20+ memory plugins from "each its own warehouse" into "one protocol, many stores" — the
interoperability point competitors (Claude Code / Codex / OpenCode / Hermes) do not offer
across their closed memory forms.

## Differences from the current official seam

| Aspect | Official seam today (rc.6) | dsh-memory-protocol v1 |
| --- | --- | --- |
| Memory service | none (MCP "memory = external server" position; plugins bring their own) | typed `ctx.memory` + adapter registry `ctx.memoryAdapters` |
| Write gate | per-plugin, usually tool-layer | enforced inside provider write methods; policy is model-invisible config |
| Entry model | per-plugin | protocol v1: two tracks × two layers × per-agent key + `tags` + per-entry `version` |
| Budgets | per-plugin | hard per-track×scope character budgets with structured errors |
| Audit | per-plugin | approval pair + provider ledger + `<action>-denied` rows; reconstruction guaranteed |
| Interop | none | conformance suite + reference adapters (mem0, Hermes memory.md, CLAUDE.md) |
| Session events | — | `memory/added|updated|removed|recalled|snapshot` vocabulary already merge-declared; runtime emission turns on automatically once the harness registers the types |

## Migration path

1. **Adopt the entry vocabulary** (tracks/scopes/agentKey) — dsh-memento's `types.d.ts` merge
   declarations are a drop-in starting point; no behavior change for existing plugins.
2. **Register `memory/*` session event types** in `KNOWN_SESSION_EVENT_TYPES` (or add an
   `ignorable` append surface). The reference implementation already gates emission on that set,
   so no data or audit gap appears before or after the change.
3. **Land the provider service shape** (`budgets`/`add`/`replace`/`remove`/`query`/`seed`) as
   the official Service Definition; the protocol core (`lib/protocol.mjs`, zero DSH dependencies)
   is structured to be lifted into the harness as-is.
4. **Adopt the conformance suite** as the ecosystem gate: `dsh plugin verify` can run it against
   any installed memory plugin.

Backward compatibility: the protocol is a normalization and extension of dsh-memento's shipped
0.3.x seam — existing behavior is preserved; `tags`/`version`/adapters are additive. The
reference implementation stays installable as a community plugin regardless of whether or when
the harness adopts the protocol.
