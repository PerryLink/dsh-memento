// scripts/loader-runner.mjs — real Loader composition runner (community
// five-layer model, layer 4). An independent process boots a real Context,
// mounts the vendored Loader with the Include builtin, reads the given
// cordis.yml (service rows + plugin row + config), then asserts the plugin's
// contributions through the authoritative registries and executes one real
// behavior. Config is applied by the Loader, so the expected outcome proves
// the config in the file was honored. The `reload` scenario additionally
// rewrites the cordis.yml and drives the include entry's refresh() — the same
// transaction the HMR watcher triggers — asserting the two halves of the
// 0.1.7-alpha config contract: a VOLATILE-only edit is committed into the
// running fiber (same service instance, no route churn), while an ORDINARY
// edit remounts it (contribution teardown, then a single clean re-registration).
//
// Usage: node scripts/loader-runner.mjs <cordis.yml> en|zh|reload
// Exit 0 prints DSH_LOADER_RESULT <json>; any assertion or load failure exits
// non-zero with the reason on stderr (used by the invalid-config and
// default-export regression cases).

import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
const CallId = (/** @type {string} */ id) => /** @type {import('@deepseek-ai/dsh-tools').ToolExecution['callId']} */ (id)
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

// cordis 的 logger 默认**只缓冲**（最小 composition 不装 console exporter），而
// Loader 1.0.4 起把「entry 导入失败 / config 解析失败」经 `ctx.logger.error` 报出
// 后**返回**——不再 reject `loader.await()`。没有 sink 时这种失败是静默 no-op：
// 行只是没挂上，负例断言于是看到自己的兜底错误而不是真实原因。把每条记录镜像到
// stderr；`levels.default` 放行全部等级（Loader 这些失败走 error）。
ctx.logger.exporter({
  colors: false,
  levels: { default: 3 },
  export: (message) => {
    const text = message.args
      .map((arg) => {
        if (arg instanceof Error) return arg.stack ?? arg.message
        return typeof arg === 'string' ? arg : JSON.stringify(arg)
      })
      .join(' ')
    process.stderr.write(`[${message.type}] ${message.name}: ${text}\n`)
  },
})

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
     * 改写配置并跑一次 HMR 同一路径的 refresh()。
     * @param {string} from - 被替换的原文。
     * @param {string} to - 替换后的文本。
     */
    const editConfig = async (from, to) => {
      writeFileSync(configPath, readFileSync(configPath, 'utf8').replace(from, to))
      await include.refresh()
      await ctx.loader.await()
    }
    /**
     * 断言当前注册路由条数。
     * @param {number} count - 期望条数。
     * @param {string} where - 断言位置（错误信息用）。
     */
    const expectRoutes = (count, where) => {
      if (webServer.list().length !== count) throw new Error(`reload/${where}: expected ${count} routes, got ${webServer.list().length}`)
    }
    /**
     * 断言工具描述的文案语言（注册期固定的面）。
     * @param {{description: string}} tool - tools 注册表里的 memory 工具。
     * @param {string} language - 期望语言。
     * @param {string} where - 断言位置（错误信息用）。
     */
    const expectLanguage = (tool, language, where) => {
      const ok = language === 'zh' ? tool.description.includes('读写') : tool.description.includes('bounded')
      if (!ok) throw new Error(`reload/${where}: memory tool description does not reflect language=${language}`)
    }

    // Phase 1: initial mount — seam live, English description, 3 routes.
    const first = ctx.get('memory')
    if (first === undefined) throw new Error('reload: ctx.memory service is missing')
    expectRoutes(3, 'initial')
    const firstTool = ctx.tools.get('memory')
    expectLanguage(firstTool, 'en', 'initial')
    const firstRoutes = webServer.list().slice()

    // Phase 2: language:'zh' is a VOLATILE field — the Loader commits it into the
    // running fiber's own reference and emits `loader/volatile-update`; the plugin
    // is NOT remounted, so the service instance and the registered routes survive
    // (`language` reaches commands/snapshot/panel live; registration-time surfaces
    // such as the tool description follow on reload, which is the documented split).
    await editConfig("language: 'en'", "language: 'zh'")
    if (ctx.get('memory') !== first) throw new Error('reload/volatile: a volatile-only edit must not remount the fiber')
    if (webServer.list().length !== 3 || webServer.list().some((/** @type {object} */ route, /** @type {number} */ index) => route !== firstRoutes[index])) {
      throw new Error('reload/volatile: registered routes must survive a volatile-only edit')
    }
    if (first.language !== 'zh') throw new Error(`reload/volatile: hot field did not apply (language=${first.language})`)
    expectLanguage(ctx.tools.get('memory'), 'en', 'volatile')

    // Phase 3: `enabled` is ORDINARY config — an edit to it remounts the fiber and
    // every contribution unloads (no half-state, no duplicate route).
    await editConfig('enabled: true', 'enabled: false')
    if (ctx.get('memory') !== undefined) throw new Error('reload/ordinary: the memory service survived an ordinary remount')
    expectRoutes(0, 'disabled')

    // Phase 4: back on — a second cycle must behave the same, with exactly one
    // registration of every contribution.
    await editConfig('enabled: false', 'enabled: true')
    const second = ctx.get('memory')
    if (second === undefined || second === first) throw new Error('reload/ordinary: the memory service did not come back as a new instance')
    expectRoutes(3, 'remounted')
    expectLanguage(ctx.tools.get('memory'), 'zh', 'remounted')

    process.stdout.write(`DSH_LOADER_RESULT ${JSON.stringify({ routes: webServer.list().length, cycled: true, volatileInPlace: ctx.get('memory') === second })}\n`)
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
