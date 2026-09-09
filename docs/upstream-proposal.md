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

## Alignment with official ctx.storage (0.1.5-alpha.1)

> Status check 2026-09-09, read-only against `origin/master` = `5dda764e`
> (`0.1.5-alpha.1`). The sections above were written when the official
> harness had no storage subsystem. That has changed, so this proposal is
> realigned: instead of a new top-level `ctx.memory` seam, memory protocol
> v1 now mounts on the official storage hub -- its persistence rides
> `ctx.storage.domain`, and the json/sqlite dual backend already exists.
> The earlier sections stay as the protocol rationale; the rc.6-era
> "Differences from the current official seam" table stays as a historical
> snapshot, superseded by this section.

### What the official seam now provides (recorded from source)

The `packages/storage` group (host-side only; no model-facing surface)
ships four packages:

- `storage` (`@deepseek-ai/dsh-storage`) -- the hub `ctx.storage`: a named
  backend table (`BackendRegistry`: `register` / `get` / `names`; errors
  `duplicate-backend` / `backend-not-found`) plus a data-form mount table.
  `StorageForms` is an empty declaration-merge interface; `mount(form,
  facility)` returns an unmount disposer (error `duplicate-mount`),
  `form(form)` resolves a mounted form (error `form-not-mounted`), and the
  `domain` getter is the typed accessor for the domain form.
  `storageBackendServiceKey(name)` yields the lifecycle-only key
  `storage.backend.<name>` that domain providers inject so activation
  cannot race backend registration.
- `storage-json` (`@deepseek-ai/dsh-storage-json`) -- registers backend
  `json` (one human-readable file per unit, or per-record documents).
- `storage-sqlite` (`@deepseek-ai/dsh-storage-sqlite`) -- registers backend
  `sqlite` (units as JSON documents in one database).
- `storage-domain` (`@deepseek-ai/dsh-storage-domain`) -- plugin name
  `storage-domain`, `inject: ['storage']`; mounts `DomainFacility` under
  `StorageForms['domain']` and provides `ctx.storageDomain`. `Config` =
  `{ backend: string, routes?: Record<string, string> }` -- the default
  backend plus per-domain overrides. `DomainFacility.open(spec)` opens a
  declared domain over a routed backend (errors: `already-open`,
  `backend-not-found`, `facet-unsupported`, `invalid-record` with an
  optional `backup-and-skip` policy, and backend `version-mismatch` /
  `malformed-medium`); `get(name)` is the untyped lookup; `closeAll()`
  closes everything. `defineDomain` / `domainTable` / `descriptorOf`
  declare specs with zod record schemas; open domains emit
  `domain/changed` events.

The domain layer is deliberately generic: schema-validated, change-emitting
KV with no memory semantics (no budgets, no approval, no audit). The
workspace subsystem is its first consumer, and
`session-projection-cache/src/spec.ts` already declares its domain with
`defineDomain` -- the mounting pattern this proposal now follows.

### Realigned adoption framing

**From "new ctx.memory seam" to "memory protocol v1 on ctx.storage.domain".**

1. **Entry model -> `DomainSpec`.** Declare the memory store once with
   `defineDomain`: tracks become tables, entries become zod-validated
   records keyed by agent key + entry id, `version` carries the protocol
   schema version, and `compatibleVersions` carries the migration list.
   The domain layer's loud `invalid-record` failure (plus the optional
   `backup-and-skip` policy) matches the protocol's "fail loud, never
   silently truncate" stance.
2. **Medium -> existing backends.** No backend work: open the domain over
   `sqlite` (point updates, WAL) or `json` (portable, human-readable)
   through the domain plugin's `Config.backend` / `Config.routes`. The
   json/sqlite dual backend already exists upstream.
3. **Service -> thin protocol layer over the domain handle.** The official
   seam contributes the storage spine; the protocol's semantics -- the
   write gate enforced inside the provider, model-invisible
   `writePolicy`, per-track/per-layer budgets, the audit ledger, the
   conformance suite -- stay in the memory layer
   (`MemoryProtocolCore` / `MemoryService`), which owns the `Domain`
   handle returned by `ctx.storage.domain.open(spec)` and keeps the
   approval transport on top of it.
4. **Naming -> StorageForms / domain vocabulary.** When a service-shaped
   face is wanted, promote the memory facility to a mounted data form via
   declaration merging (`interface StorageForms { memory: MemoryFacility }`,
   the `domain: DomainFacility` precedent), mount it in `apply` with
   `ctx.storage.mount('memory', facility)` (disposal unmounts), and reach
   it as `ctx.storage.memory` -- the `ctx.storage.domain` getter is the
   precedent. Inject `storageBackendServiceKey('sqlite')` so the form
   never activates before its backend (the storage-domain precedent). The
   earlier `ctx.memory` / `ctx.memoryAdapters` vocabulary is superseded
   by `ctx.storage.memory` plus the adapter registry inside the facility.

### Realigned migration path

1. Declare the memory `DomainSpec` and publish it; existing plugins see no
   behavior change, and the conformance suite remains the acceptance gate.
2. Route the domain to `sqlite` by default (or `json` for portable stores)
   via the domain plugin `Config` -- no backend code changes.
3. Land the memory data form (`StorageForms['memory']`) as the official
   provider shape: the protocol core rides the `Domain` handle, keeps the
   approval transport and audit ledger, and mounts/unmounts as an effect.
4. Register the `memory/*` session event types when the session event
   vocabulary opens up (unchanged from above); conformance suite adoption
   unchanged.

Backward compatibility: the earlier "new `ctx.memory` seam" path is a
subset of this framing -- the protocol still ships and rehearses as a
community plugin; only the official surface it targets has changed.
