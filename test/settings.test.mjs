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
