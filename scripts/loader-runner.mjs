// scripts/loader-runner.mjs — real Loader composition runner (community
// five-layer model, layer 4). An independent process boots a real Context,
// mounts the vendored Loader with the Include builtin, reads the given
// cordis.yml (service rows + plugin row + config), then asserts the plugin's
// contributions through the authoritative registries and executes one real
// behavior. Config is applied by the Loader, so the expected outcome proves
// the config in the file was honored. The `reload` scenario additionally
// rewrites the cordis.yml twice (language en → zh → en) and drives the
// include entry's refresh() — the same transaction the HMR watcher triggers —
// asserting the panel routes unload with the fiber and re-register without a
// duplicate route.
//
// Usage: node scripts/loader-runner.mjs <cordis.yml> en|zh|reload
// Exit 0 prints DSH_LOADER_RESULT <json>; any assertion or load failure exits
// non-zero with the reason on stderr (used by the invalid-config and
// default-export regression cases).

import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
const CallId = ((id) => id)
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const configArgument = process.argv[2]
const expected = process.argv[3]
if (configArgument === undefined || (expected !== 'en' && expected !== 'zh' && expected !== 'reload')) {
  console.error('usage: loader-runner.mjs <cordis.yml> en|zh|reload')
  process.exit(2)
}

const configPath = resolve(configArgument)
const configRequire = createRequire(resolve(import.meta.dirname, '../package.json'))

const ctx = new Context()
try {
  ctx.baseUrl = `${pathToFileURL(dirname(configPath)).href}/`
  await ctx.plugin(Loader)
  ctx.loader.internal = /** @type {any} */ ({
    version: 'v2',
    /** @param {string} specifier */
    async import(specifier) {
      if (specifier.startsWith('file:')) return import(specifier)
      if (specifier.startsWith('node:')) return import(specifier)
      const absolute = /^([a-zA-Z]:)?[\\/]/u.test(specifier)
      return import(pathToFileURL(absolute ? specifier : configRequire.resolve(specifier)).href)
    },
  })
  ctx.loader.builtins.include = Include
  const includeId = await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()

  if (expected === 'reload') {
    const include = /** @type {any} */ (ctx.loader.resolve(includeId)?.subtree)
    if (include === undefined || typeof include.refresh !== 'function') {
      throw new Error('reload: the include entry exposes no refresh()')
    }
    const webServer = /** @type {any} */ (ctx.get('webServer'))
    if (webServer === undefined) throw new Error('reload: the mock webServer row did not mount')
    /**
     * Assert the seam (service + tools), the language knob, and the routes.
     * @param {string} language - the expected tool-description language.
     */
    const assertBase = (language) => {
      if (ctx.get('memory') === undefined) throw new Error('reload: ctx.memory service is missing')
      const tool = ctx.tools.get('memory')
      if (tool === undefined) throw new Error('reload: memory tool is missing')
      const languageOk = language === 'zh' ? tool.description.includes('读写') : tool.description.includes('bounded')
      if (!languageOk) throw new Error(`reload: memory tool description does not reflect language=${language}`)
      if (webServer.list().length !== 3) throw new Error(`reload: expected 3 routes, got ${webServer.list().length}`)
    }

    // Phase 1: initial mount — seam live, English description, 3 routes.
    assertBase('en')

    // Phase 2: language:'zh' — the fiber restarts with the new config; the
    // routes unload and re-register without a duplicate route.
    writeFileSync(configPath, readFileSync(configPath, 'utf8').replace("language: 'en'", "language: 'zh'"))
    await include.refresh()
    await ctx.loader.await()
    assertBase('zh')

    // Phase 3: back to 'en' — a second cycle must behave the same.
    writeFileSync(configPath, readFileSync(configPath, 'utf8').replace("language: 'zh'", "language: 'en'"))
    await include.refresh()
    await ctx.loader.await()
    assertBase('en')

    process.stdout.write(`DSH_LOADER_RESULT ${JSON.stringify({ routes: webServer.list().length, cycled: true })}\n`)
  } else {
  // Authoritative registries carry the plugin's contributions.
  if (ctx.get('memory') === undefined) {
    throw new Error('Loader composition: ctx.memory service is missing')
  }
  if (ctx.tools.get('memory') === undefined) {
    throw new Error('Loader composition: memory tool is missing from the tools registry')
  }
  if (ctx.tools.get('memory_recall') === undefined) {
    throw new Error('Loader composition: memory_recall tool is missing from the tools registry')
  }

  // The tool description language proves the `language` config was applied.
  const description = ctx.tools.get('memory').description
  const languageApplied = expected === 'zh' ? description.includes('读写') : description.includes('bounded')
  if (!languageApplied) {
    throw new Error(`Loader composition: memory tool description does not reflect language=${expected}`)
  }

  // Real behavior: a read-only memory query through the real tools registry.
  const agent = /** @type {any} */ ({
    id: 'agent-1',
    options: { provider: 'deepseek', model: 'demo-model' },
    session: { id: 's1', header: {} },
    inbox: {},
    status: 'idle',
    ctx,
    cancel: /** @type {() => void} */ (() => undefined),
    whenIdle: /** @type {() => Promise<void>} */ (async () => undefined),
    runMaintenance: /** @type {(task: (signal: AbortSignal) => Promise<unknown>) => Promise<unknown>} */ (async (task) => task(new AbortController().signal)),
    send: /** @type {() => void} */ (() => undefined),
    followup: /** @type {() => void} */ (() => undefined),
    steer: /** @type {() => void} */ (() => undefined),
    inject: /** @type {() => void} */ (() => undefined),
  })
  const result = await ctx.tools.execute({
    callId: CallId('dsh-memento-loader-runner'),
    name: 'memory',
    arguments: { action: 'query', text: 'preferences' },
    agent,
    signal: new AbortController().signal,
  })
  const value = /** @type {any} */ (result.value)
  if (result.isError !== false || value?.ok !== true || value?.action !== 'query') {
    throw new Error(`Loader composition: memory query returned ${JSON.stringify(result)}`)
  }

  const summary = {
    memoryService: ctx.get('memory') !== undefined,
    tools: ctx.tools.schemas().map((schema) => schema.name),
    language: expected,
    queryOk: value.ok === true,
  }
  process.stdout.write(`DSH_LOADER_RESULT ${JSON.stringify(summary)}\n`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
} finally {
  await ctx.fiber.dispose()
}
