// test/settings.test.mjs — 宿主设置面板接线：dsh-memento namespace 注册、
// 启动期字段合成、热字段 watch 生效、非法值防御、面板 panel 开关透出。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { apply, DEFAULT_BUDGETS } from '../index.mjs'
import { createMockCtx, makeAgent, makeExec } from './helpers/mock-ctx.mjs'

/**
 * 假 settings 服务：register 语义对齐 @deepseek-ai/dsh-settings（npm alpha.3 与
 * 宿主内置副本一致的共同面）。current = 组合层 + 用户层浅覆盖；publish 模拟一次
 * 用户写入提交。
 * @param {object} [userLayer] - settings.yaml 用户层（相对组合层的覆盖）。
 */
function makeFakeSettings(userLayer = {}) {
  /** @type {Array<{ns: string, entry: object}>} */
  const installs = []
  /** @type {Array<() => void>} */
  const watchers = []
  let current = /** @type {Record<string, unknown> | undefined} */ (undefined)
  const service = {
    register(/** @type {string} */ ns, /** @type {object} */ _schema, /** @type {{base: object, validate?: (value: object) => void}} */ options) {
      installs.push({ ns, entry: options.base })
      current = {
        ...options.base,
        ...userLayer,
        panel: { enabled: true, ...(userLayer.panel ?? {}) },
      }
      // 对齐真件语义：register 内 resolve 时先过 validate，非法存量在注册路径响亮抛出。
      if (options.validate !== undefined) options.validate(current)
      const scope = {
        get: () => current,
        watch(/** @type {() => void} */ cb) {
          watchers.push(cb)
          return () => {}
        },
      }
      return scope
    },
    // npm alpha.3/4 线形态（本地 node_modules 副本）：类方法 installSection。
    // 宿主内置线（模块级 installSettingsSection）与它只差取用方式，行为相同。
    installSection(/** @type {object} */ _owner, /** @type {string} */ ns, /** @type {object} */ schema, /** @type {object} */ entry, /** @type {{setSource: (fn: () => object) => void, onChange: () => void, validate?: (value: object) => void}} */ hooks) {
      const scope = service.register(ns, schema, { base: entry, validate: hooks.validate })
      hooks.setSource(() => scope.get())
      hooks.onChange()
      scope.watch(() => hooks.onChange())
    },
    /** 模拟一次已提交的用户层写入（provider → publish → watchers）。 */
    publish(/** @type {object} */ patch) {
      current = { .../** @type {Record<string, unknown>} */ (current), ...patch }
      for (const cb of watchers) cb()
    },
  }
  return { service, installs, publish: service.publish.bind(service) }
}

/** 组合配置基座（与 v2 mount 同形）。 */
function composedOptions(dir, overrides = {}) {
  return {
    enabled: true,
    dbPath: path.join(dir, 'memory.db'),
    budgets: DEFAULT_BUDGETS,
    writePolicy: 'auto',
    snapshotOrder: -50,
    maxEntriesPerQuery: 20,
    commandListLimit: 50,
    commandAuditLimit: 10,
    language: 'zh',
    recall: { historyLimitDefault: 8, snippetCap: 5, snippetChars: 300, windowDays: 30 },
    panelEntriesLimit: 200,
    panelAuditLimit: 20,
    auditRetentionDays: 0,
    ...overrides,
  }
}

/**
 * 标准装载（默认挂 webServer 捕获路由），返回待清理组合。
 * @param {object} [opts] - {userLayer, composed, withSettings}。
 */
function mount(opts = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-memento-settings-'))
  const mock = createMockCtx()
  // 审批 answerer 在 waterfall 上（同 v2 集成测试）：auto/off 在 answerer 短路。
  mock.ctx.approval = {
    config: { policy: 'ask' },
    overrideOf() { return undefined },
    async request(req) { return mock.ctx.waterfall('approval/request', req, async () => 'unavailable') },
  }
  /** @type {Array<object>} */
  const routes = []
  mock.ctx.provide('webServer', { register(route) { routes.push(route); return () => {} } })
  const fake = makeFakeSettings(opts.userLayer)
  if (opts.withSettings !== false) mock.ctx.provide('settings', fake.service)
  apply(mock.ctx, composedOptions(dir, opts.composed))
  const teardown = () => {
    mock.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
  return { mock, fake, routes, teardown }
}

/** 同步执行一条面板路由并解析 JSON 响应。 */
function callRoute(/** @type {{path: string, handler: (req: object, res: object) => Promise<void>}} */ route) {
  /** @type {Array<string>} */
  const bodies = []
  void route.handler({ url: route.path }, {
    writeHead(_status, _headers) {},
    end(/** @type {string} */ body) { bodies.push(body) },
  })
  return JSON.parse(bodies[0])
}

test('settings 缺失（headless）：行为与组合配置一致，panel 默认开启', () => {
  const mounted = mount({ withSettings: false })
  try {
    const { mock, routes } = mounted
    assert.equal(mock.ctx.get('memory').language, 'zh')
    assert.equal(mock.ctx.get('memory').writePolicy, 'auto')
    const entries = routes.find((route) => route.path === '/api/memento/entries')
    assert.ok(entries)
    const payload = callRoute(entries)
    assert.equal(payload.panel.enabled, true)
    assert.equal(payload.language, 'zh')
  } finally {
    mounted.teardown()
  }
})

test('settings 先挂载：installSection 以 dsh-memento 注册，启动期字段采用用户层', () => {
  const mounted = mount({ userLayer: { language: 'en', snapshotOrder: -70 } })
  try {
    const { mock, fake } = mounted
    assert.equal(fake.installs.length, 1)
    assert.equal(fake.installs[0].ns, 'dsh-memento')
    // 启动期字段（snapshotOrder 用户层 -70）在 section 注册前合成
    assert.equal(mock.sections.length, 1)
    assert.equal(mock.sections[0].order, -70)
    // 热字段（language）同样来自用户层
    assert.equal(mock.ctx.get('memory').language, 'en')
  } finally {
    mounted.teardown()
  }
})

test('settings 后到：热字段即时生效，启动期字段留痕并要求重载', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-memento-settings-'))
  const mock = createMockCtx()
  try {
    const fake = makeFakeSettings({ language: 'en', dbPath: path.join(dir, 'moved.db') })
    apply(mock.ctx, composedOptions(dir))
    assert.equal(mock.ctx.get('memory').language, 'zh') // 服务未到前保持组合值
    mock.ctx.provide('settings', fake.service) // pendingInjects flush → 接线
    assert.equal(fake.installs.length, 1)
    assert.equal(mock.ctx.get('memory').language, 'en') // 热字段即时生效
    // 启动期字段（dbPath）变更：重开 store 并响亮留痕（settings-startup-fields）
    const audit = mock.ctx.get('memory').store.auditList(10)
    const row = audit.find((entry) => entry.action === 'settings-startup-fields')
    assert.ok(row)
    assert.match(row.text, /applied: .*dbPath\/auditRetentionDays/)
  } finally {
    mock.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('watch 热更：publish 后 writePolicy/language 即时生效', () => {
  const mounted = mount()
  try {
    const { mock, fake } = mounted
    const service = mock.ctx.get('memory')
    assert.equal(service.writePolicy, 'auto')
    assert.equal(service.language, 'zh')
    fake.publish({ writePolicy: 'off', language: 'en' })
    assert.equal(service.writePolicy, 'off')
    assert.equal(service.language, 'en')
  } finally {
    mounted.teardown()
  }
})

test('panel 开关：publish 关闭后 entries 路由透出 panel.enabled=false', () => {
  const mounted = mount()
  try {
    const { fake, routes } = mounted
    const entries = routes.find((route) => route.path === '/api/memento/entries')
    assert.equal(callRoute(entries).panel.enabled, true)
    fake.publish({ panel: { enabled: false } })
    assert.equal(callRoute(entries).panel.enabled, false)
  } finally {
    mounted.teardown()
  }
})

test('非法用户层值：register 时响亮拒绝（apply 抛错）', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-memento-settings-'))
  const mock = createMockCtx()
  try {
    const fake = makeFakeSettings({ language: 'fr' })
    mock.ctx.provide('settings', fake.service)
    assert.throws(() => apply(mock.ctx, composedOptions(dir)), /language must be 'en' or 'zh'/)
  } finally {
    mock.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('工具执行面不受 settings 缺失影响（回归）', async () => {
  const mounted = mount({ withSettings: false, composed: { writePolicy: 'auto' } })
  try {
    const tool = mounted.mock.tools.find((def) => def.name === 'memory')
    assert.ok(tool)
    const result = await tool.execute({ action: 'add', track: 'user', scope: 'workspace', text: 'hello' }, makeExec({ agent: makeAgent() }))
    assert.equal(result.ok, true)
  } finally {
    mounted.teardown()
  }
})

test('G-9 关→开两次：贡献恰一份、订阅不重复、服务与检索器注册零残留、重装后仍可用', async () => {
  /** 一次「开」的完整断言（含 vector 检索器这条自持 disposer 的路径）。 */
  const activateAndAssert = async (round) => {
    const mounted = mount({ composed: { retrieval: { vector: true } } })
    const { mock, fake, routes } = mounted
    const registry = mock.ctx.get('memoryRetrieval')
    // ① 贡献恰一份（工具/快照段/面板路由/命令各自只有一份）
    assert.equal(mock.tools.length, 2, `第 ${round} 轮：memory + memory_recall 各一份`)
    assert.equal(mock.sections.length, 1, `第 ${round} 轮：快照段恰一份`)
    assert.equal(routes.length, 3, `第 ${round} 轮：面板只读路由恰三条`)
    // ② 订阅不重复（三个挂载期监听器各一条）
    assert.equal(mock.listeners.get('approval/request').length, 1, `第 ${round} 轮：审批 answerer 恰一条`)
    assert.equal(mock.listeners.get('session/event').length, 1, `第 ${round} 轮：会话事件监听恰一条`)
    // ③ 设置命名空间只注册一次
    assert.equal(fake.installs.length, 1, `第 ${round} 轮：dsh-memento 命名空间只注册一次`)
    assert.equal(fake.installs[0].ns, 'dsh-memento')
    // ④ 检索器注册面（含 vector：自持 disposer 的注册）齐全
    assert.deepEqual(registry.list().map((provider) => provider.id), ['substring', 'vector'], `第 ${round} 轮：两个检索器都在`)
    // ⑤ 重装后功能仍可用：写入 + 读回
    const service = mock.ctx.get('memory')
    await service.add({ track: 'user', scope: 'workspace', text: `第 ${round} 轮写入` }, { agent: makeAgent() })
    assert.equal(service.query({ text: `第 ${round} 轮写入` }).total, 1)
    // 关：卸载后服务、订阅目标与检索器注册全部下线（vector 不残留）
    mounted.teardown()
    assert.equal(mock.services.size, 0, `第 ${round} 轮卸载后：服务句柄零残留`)
    assert.deepEqual(registry.list(), [], `第 ${round} 轮卸载后：检索器注册零残留（含 vector）`)
  }
  await activateAndAssert(1)
  await activateAndAssert(2)
})

test('retrieval.vector 热切换：登记失败响亮留痕且不留半状态，恢复后重新启用', () => {
  const mounted = mount({ composed: { retrieval: { vector: true } } })
  try {
    const { mock, fake } = mounted
    const registry = mock.ctx.get('memoryRetrieval')
    const service = mock.ctx.get('memory')
    assert.deepEqual(registry.list().map((provider) => provider.id), ['substring', 'vector'])

    // 先关（成功），再开但让登记抛 INACTIVE_EFFECT 形态的错：不得留下半状态
    fake.publish({ retrieval: { vector: false } })
    assert.deepEqual(registry.list().map((provider) => provider.id), ['substring'])
    const originalEffect = mock.ctx.effect
    let failNext = true
    mock.ctx.effect = (callback, label) => {
      if (failNext) {
        failNext = false
        throw new Error('INACTIVE_EFFECT (fiber disposed)')
      }
      return originalEffect(callback, label)
    }
    try {
      fake.publish({ retrieval: { vector: true } })
    } finally {
      mock.ctx.effect = originalEffect
    }
    // 失败可见（审计留痕）+ 无半状态（没有 vector 注册，也没有坏掉的注册）
    const failure = service.store.auditList(10).find((row) => row.action === 'settings-swap-failed')
    assert.ok(failure, '登记失败必须响亮留痕')
    assert.equal(failure.outcome, 'error')
    assert.match(failure.text, /^retrieval\.vector: INACTIVE_EFFECT/)
    assert.deepEqual(registry.list().map((provider) => provider.id), ['substring'], '失败后不残留半注册')
    // 失败不影响其余热字段与既有功能
    fake.publish({ language: 'en' })
    assert.equal(service.language, 'en')
    assert.equal(service.query({ text: '任意' }).total, 0)
    // 恢复：同一次热切换重试必须成功（插件没有被失败卡死）
    fake.publish({ retrieval: { vector: true } })
    assert.deepEqual(registry.list().map((provider) => provider.id), ['substring', 'vector'])
  } finally {
    mounted.teardown()
  }
})
