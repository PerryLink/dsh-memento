# Making your memory plugin speak dsh-memory-protocol

> 中文版见 [adapters-guide.zh.md](adapters-guide.zh.md)。The protocol itself is specified in
> [protocol-v1.md](protocol-v1.md); the adapter registry service is `ctx.memoryAdapters`.

Two roads lead to the protocol. Pick the one that matches what your plugin already is:

| Your plugin is… | Road | What you implement |
| --- | --- | --- |
| a DSH plugin with its own store | **Provider conformance** | the provider surface from [`test/protocol-conformance/README.md`](../test/protocol-conformance/README.md) — you keep your store, you implement the protocol semantics (gate inside the service, budgets, audit) |
| a DSH plugin that wants to feed/read **dsh-memento's** store | **Adapter registration** | register an adapter on `ctx.memoryAdapters`; your external format converts to/from protocol entries |

This guide covers the adapter road. If your plugin keeps its own store and merely wants to
*interoperate*, register an adapter that converts your store's export format; imports/exports
then ride the same approval-gated `seed` path.

## The adapter contract

```js
// your-plugin/adapters/my-format.mjs
export const myFormatAdapter = {
  id: 'my-format',               // lowercase kebab-case, unique in the registry
  name: 'My format',
  description: 'Converts my-format exports to protocol entries and back.',
  version: '1.0.0',
  importFormats: ['my-format-v1'],   // labels shown by /memory adapters
  exportFormat: 'my-format-v1',

  // payload -> protocol entry inputs. Pure data conversion ONLY:
  // never call a model for extraction or summarization.
  adapt(payload) {
    // return { entries: [{ track, scope, text, source?, tags?, workspaceKey?, agentKey? }] }
  },

  // protocol entries -> your format (JSON-safe value)
  export(entries) {
    // return your format document
  },
}
```

## Registering (reversibly)

```js
import { myFormatAdapter } from './adapters/my-format.mjs'

export function apply(ctx) {
  const adapters = ctx.get('memoryAdapters')   // optional dependency: dsh-memento may be absent
  if (adapters !== undefined) {
    // register() returns a disposer — hand it to ctx.effect and Cordis
    // undoes the registration when your plugin stops/updates.
    ctx.effect(() => adapters.register(myFormatAdapter))
  }
}
```

Registration errors fail loudly (`INVALID_INPUT` for a malformed adapter, duplicate id
included). Never catch and swallow them.

## Conversion rules that keep you conformant

1. **Convert data, never infer.** If a payload has no fact-level entries (e.g. raw chat
   transcripts), fail loudly with `ADAPTER_PAYLOAD` and tell the caller to extract first.
   The protocol is a storage interop surface, not a reasoning surface.
2. **Validate every field you emit.** `track`/`scope` must be protocol vocabulary; `text`
   non-empty; `tags` ≤16 entries × ≤32 chars. The provider re-validates on `seed`, but a good
   adapter never emits garbage.
3. **Fail loud on unrepresentable structure.** A line you cannot map to an entry should throw
   with a line number, not become a mangled entry.
4. **Be honest about lossiness in `description`.** `export` may omit fields your format has no
   concept for (e.g. tags) — say so.
5. **Idempotent and side-effect-free.** `adapt`/`export` must not write files, hit the network,
   or touch the store. Import persistence happens in `seed` — one approval, one transaction,
   per-entry audit rows.

## What users get

Once your adapter is registered (yours ships with your plugin, or anyone registers it at
runtime), these surfaces light up for free:

```sh
/memory adapters                                  # list registered adapters + formats
/memory import --adapter=my-format ./export.json  # convert + seed: ONE approval, audited
/memory export --adapter=my-format                # read-only conversion to stdout
```

## Reference adapters (shipped with dsh-memento)

| Adapter id | External format | Notes |
| --- | --- | --- |
| `mem0` | mem0 fact collections (`{facts: [{memory, metadata?}]}` or bare array) | `metadata.category`/`metadata.tags` become tags; raw `messages` arrays are rejected — extraction is the caller's job |
| `hermes-memory-md` | Hermes `memory.md` (`## section` + bullets) | section names become tags; non-bullet prose lines fail loudly |
| `claude-code-memory-md` | `CLAUDE.md`-style markdown (headings, bullets, paragraphs) | bullets and blank-line-separated paragraphs become entries; section names become tags |

These are production examples of the contract — read `lib/adapters.mjs` alongside this guide.
