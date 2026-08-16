# dsh-memory-protocol v1 — Protocol Conformance Suite

A distributable set of conformance cases for `dsh-memory-protocol/v1`. Any provider that
claims protocol compatibility runs the **same** cases against its own store; this repository's
CI runs them against its own provider as the golden reference (all green).

The normative spec is [`../../docs/protocol-v1.md`](../../docs/protocol-v1.md); the machine-readable
schema is [`../../docs/schemas/dsh-memory-protocol-v1.schema.json`](../../docs/schemas/dsh-memory-protocol-v1.schema.json).

## Provider contract

Write a factory module that exports `makeProvider(options)` and returns a provider with this surface:

```js
// options = { dbPath, budgets?, gate? }
// - dbPath: absolute path for a private SQLite (or other) store file (fresh per case)
// - budgets: { user: {userGlobal, workspace}, agent: {userGlobal, workspace} } (case-tunable)
// - gate: async (payload, write) => ApprovalOutcome  — test-time approval transport;
//   the suite injects it to test denial and approval payloads. Your production gate can differ;
//   the factory only wires this hook for conformance runs.
export function makeProvider(options) {
  return {
    async add(input, write) {},        // → { entry, usage } | throws error with .code
    async replace(input, write) {},    // → { previous, entry, usage }
    async remove(input, write) {},     // → { entry, usage }
    async consolidate(input, write) {},// → { removed, entry, usage }
    async seed(inputs, write) {},      // → { added, entries }
    query(filter, opts) {},            // → { entries, total, truncated }
    budgets() {},                      // → [{ track, scope, used, limit }]
    listEntries() {},                  // → entries (protocol entry shape)
    auditList(limit) {},               // → audit rows [{ action, text, entryId, outcome, ... }]
    close() {},                        // optional; called by the runner
  }
}
```

Writes receive `write = { agent: { session: { id, header? } } }`. Failures must throw with the
protocol error code on the error's `code` field (`INVALID_INPUT`, `WRITE_REQUIRES_AGENT`,
`BUDGET_EXCEEDED`, `ENTRY_NOT_FOUND`, `AMBIGUOUS_MATCH`, `WRITE_DENIED`).

## Run

```sh
# against the golden reference (dsh-memento's own provider)
node test/protocol-conformance/run.mjs

# against your provider
node test/protocol-conformance/run.mjs --provider ./my-factory.mjs

# filter + machine-readable report
node test/protocol-conformance/run.mjs --provider ./my-factory.mjs --filter B --json
```

Exit code is `0` when every case passes, `1` otherwise. The suite is self-contained
(`node:assert` only); copy this directory into your project and run it unchanged.
