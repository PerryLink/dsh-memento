// test/client.test.mjs — 浏览器半的设置句柄解析与两线行为。
//
// client/client.js 不是 Node 模块：宿主把它当 classic script 注入页面，执行时经
// window.__ModuleLoader__.load 注册 factory。本套件用 node:vm 提供那一层环境，
// 拿 factory 造出客户端插件定义，再用假 ctx 驱动 apply——于是有两条硬证据：
//
// 1. `inject` 里**只有 slots**。设置句柄的两条线（0.1.7 的 configForms、旧线的
//    settingsScope）各只有一个在场，任一个写进 inject 都会让对面宿主的 fiber 永久
//    PENDING——整个客户端插件连同只读面板一起不挂载。
// 2. 两条线各自解析到正确的句柄与 namespace，缺席时降级为只读卡片（不抛）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'

/** 以宿主注入环境载入客户端 bundle，返回它注册的那一条 factory 描述。 */
function loadClientEntry() {
  const source = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
  /** @type {{id: string, factory: (require: (id: string) => unknown) => any} | undefined} */
  let registered
  const sandbox = {
    // probePanelState 是 fire-and-forget：探到 panel.enabled=false 时 installPanel
    // 不跑，所以本套件只量设置面接线，DOM 只需够样式标签与入口按钮查询用。
    fetch: async () => ({ ok: true, json: async () => ({ panel: { enabled: false } }) }),
    document: {
      getElementById: () => null,
      createElement: () => ({ dataset: {}, style: {}, appendChild() {}, addEventListener() {} }),
      head: { appendChild() {} },
      body: { appendChild() {} },
    },
    window: { __ModuleLoader__: { load(/** @type {object} */ entry) { registered = /** @type {any} */ (entry) } } },
    console,
    setTimeout,
    clearTimeout,
  }
  createContext(sandbox)
  runInContext(source, sandbox, { filename: 'client/client.js' })
  assert.ok(registered, 'bundle 必须经 window.__ModuleLoader__.load 注册 factory')
  return registered
}

/** vm 域里的对象/数组原型与宿主域不同，deepEqual 前统一转成宿主域的普通值。 */
const hostValue = (/** @type {any} */ value) => JSON.parse(JSON.stringify(value ?? null))

/** 造客户端插件定义（require 只放行 react——平台内置模块）。 */
function makeClientPlugin() {
  const entry = loadClientEntry()
  assert.equal(entry.id, 'dsh-memento', 'factory id 必须与宿主 boot 图的行一致')
  return entry.factory((id) => {
    if (id === 'react') return { createElement: () => null }
    throw new Error(`unexpected platform module: ${id}`)
  })
}

/**
 * 假客户端上下文：记录 slots 注册与 effect 回调，服务面按名字取。
 * @param {Record<string, unknown>} services - 在场服务。
 */
function makeClientCtx(services) {
  /** @type {Array<{name: string, options: object, side: () => object}>} */
  const contributions = []
  const ctx = {
    get(/** @type {string} */ name) { return services[name] },
    effect(/** @type {() => unknown} */ callback) { return callback() },
    slots: {
      inject(/** @type {string} */ name, /** @type {() => object} */ callback) {
        contributions.push({ name, options: /** @type {any} */ (callback()), side: () => /** @type {any} */ (callback()) })
        return () => {}
      },
      register(/** @type {object} */ options) { return options },
    },
  }
  return { ctx, contributions }
}

/** 0.1.7-alpha 线的 ConfigForm 替身（本插件用到的那一面）。 */
function makeFakeConfigForm() {
  const calls = { get: 0, bound: [], subscribed: 0, set: [] }
  const listeners = new Set()
  let snapshot = {
    status: 'ready',
    value: {
      language: 'zh',
      writePolicy: 'auto',
      writePolicies: {},
      dbPath: '',
      budgets: { user: { userGlobal: 2000, workspace: 2000 }, agent: { userGlobal: 4000, workspace: 4000 } },
      panel: { enabled: false },
    },
    user: { language: 'zh' },
    base: { language: 'en', writePolicy: 'ask' },
    revision: 3,
    writable: true,
    mode: 'host',
  }
  const form = {
    getSnapshot: () => snapshot,
    subscribe(/** @type {() => void} */ fn) { calls.subscribed += 1; listeners.add(fn); return () => listeners.delete(fn) },
    async set(/** @type {string} */ field, /** @type {unknown} */ value) { calls.set.push([field, value]); return true },
  }
  const configForms = {
    get(/** @type {string} */ entryId) { calls.get += 1; calls.bound.push(entryId); return form },
  }
  return { configForms, form, calls }
}

/** 旧线 settingsScope 替身。 */
function makeFakeSettingsScope() {
  const calls = { bound: [], subscribed: 0, set: [] }
  const scope = {
    getSnapshot: () => ({
      status: 'ready',
      value: { language: 'en', writePolicy: 'ask', writePolicies: {}, dbPath: '', budgets: { user: { userGlobal: 2000, workspace: 2000 }, agent: { userGlobal: 4000, workspace: 4000 } }, panel: { enabled: true } },
      user: {},
      base: {},
      writable: true,
    }),
    subscribe() { calls.subscribed += 1; return () => {} },
    async set(/** @type {string} */ field, /** @type {unknown} */ value) { calls.set.push([field, value]); return true },
  }
  const settingsScope = { bind(/** @type {{namespace: string}} */ options) { calls.bound.push(options); return scope } }
  return { settingsScope, scope, calls }
}

/** 等一个宏任务，让 save() 的 await 链跑完。 */
const settle = () => new Promise((resolve) => { setImmediate(resolve) })

test('inject 只有 slots：两条设置线都不写进 inject（否则对面宿主 fiber 永久 PENDING）', () => {
  const client = makeClientPlugin()
  assert.deepEqual(hostValue(client.inject), ['slots'])
  assert.equal(client.name, 'memento-client')
})

test('0.1.7 线：configForms.get(entryId) 是句柄来源，卡片读到实时快照', () => {
  const client = makeClientPlugin()
  const fake = makeFakeConfigForm()
  const { ctx, contributions } = makeClientCtx({ configForms: fake.configForms })
  ctx.effect(() => client.apply(ctx))
  assert.equal(fake.calls.get, 1)
  assert.deepEqual(hostValue(fake.calls.bound), ['memento'], 'namespace = profile entry id')
  assert.equal(fake.calls.subscribed, 1, '卡片必须订阅句柄（快照替换时重渲染）')
  assert.equal(contributions.length, 1)
  assert.equal(contributions[0].name, 'settings.section')
  const face = /** @type {any} */ (contributions[0].options).inject()
  const snapshot = face.hooks.mementoCard.getSnapshot()
  assert.equal(snapshot.available, true)
  assert.equal(snapshot.writable, true)
  assert.equal(snapshot.language, 'zh', '界面语言跟随句柄值的 language')
  assert.equal(snapshot.fields.language.text, 'zh')
  assert.equal(snapshot.fields.language.overridden, true, 'user 层写着该字段 ⇒ 已覆盖')
  assert.equal(snapshot.fields['panel.enabled'].text, 'false', 'ConfigForm 快照里的 panel.enabled 直接驱动悬浮窗开关')
  assert.equal(snapshot.base.language, 'en', '重置目标 = base 层')
})

test('0.1.7 线：暂存—保存按顶层聚合并经 CF.set(field, value) 写入', async () => {
  const client = makeClientPlugin()
  const fake = makeFakeConfigForm()
  const { ctx, contributions } = makeClientCtx({ configForms: fake.configForms })
  ctx.effect(() => client.apply(ctx))
  const face = /** @type {any} */ (contributions[0].options).inject()
  face.edit('panel.enabled', 'true')
  assert.equal(face.hooks.mementoCard.getSnapshot().dirty, true, '草稿不落盘，只标脏')
  assert.deepEqual(fake.calls.set, [], '未点保存前不得写入')
  face.save()
  await settle()
  assert.deepEqual(hostValue(fake.calls.set), [['panel', { enabled: true }]], '按顶层字段一次写入（路径寻址，不整体替换）')
  face.edit('language', 'fr')
  assert.equal(face.hooks.mementoCard.getSnapshot().invalid, true, '非法草稿必须在卡片上可见')
  face.save()
  await settle()
  assert.deepEqual(hostValue(fake.calls.set), [['panel', { enabled: true }]], '非法草稿不得写入')
})

test('旧线：settingsScope.bind({namespace: dsh-memento}) 仍是可用来源', () => {
  const client = makeClientPlugin()
  const fake = makeFakeSettingsScope()
  const { ctx, contributions } = makeClientCtx({ settingsScope: fake.settingsScope })
  ctx.effect(() => client.apply(ctx))
  assert.deepEqual(hostValue(fake.calls.bound), [{ namespace: 'dsh-memento' }])
  assert.equal(fake.calls.subscribed, 1)
  const face = /** @type {any} */ (contributions[0].options).inject()
  const snapshot = face.hooks.mementoCard.getSnapshot()
  assert.equal(snapshot.available, true)
  assert.equal(snapshot.language, 'en')
})

test('两条线同时在场时取 0.1.7 线（configForms 优先）', () => {
  const client = makeClientPlugin()
  const forms = makeFakeConfigForm()
  const legacy = makeFakeSettingsScope()
  const { ctx } = makeClientCtx({ configForms: forms.configForms, settingsScope: legacy.settingsScope })
  ctx.effect(() => client.apply(ctx))
  assert.equal(forms.calls.get, 1)
  assert.deepEqual(legacy.calls.bound, [], '不得回退到旧线')
})

test('两条线都不在场：卡片降级为只读，不抛错', () => {
  const client = makeClientPlugin()
  const { ctx, contributions } = makeClientCtx({})
  ctx.effect(() => client.apply(ctx))
  const face = /** @type {any} */ (contributions[0].options).inject()
  const snapshot = face.hooks.mementoCard.getSnapshot()
  assert.equal(snapshot.available, false)
  assert.equal(snapshot.writable, false, '缺席即只读（与旧线 namespace 未注册时的形态一致）')
  assert.doesNotThrow(() => face.save())
})
