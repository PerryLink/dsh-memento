// test/settings.test.mjs — 宿主设置面接线，**两条宿主线**各自断言：
//
// - 0.1.7-alpha 起（live-config 契约）：设置面就是插件自己的 Config——表单
//   namespace = profile entry id，可编辑字段 = 标了 volatile 的字段，编辑由 Loader
//   提交进 apply 收到的实时引用并发 `loader/volatile-update`（volatile-only 提交
//   不重挂 fiber）。注册面消失，插件只剩 `configure({auto:false})` 这条呈现策略。
// - 旧线（0.1.2-rc.1 / 0.1.5-alpha.1 / 0.1.6-0）：`installSection` 是那些宿主上
//   唯一的注册面，形状分派保留。
//
// 两线共用同一批行为断言：启动期字段合成、热字段生效、非法值防御、panel 开关透出。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { apply, Config, DEFAULT_BUDGETS, SETTINGS_ENTRY_ID, SETTINGS_NAMESPACE } from '../index.mjs'
import { createMockCtx, makeAgent, makeExec } from './helpers/mock-ctx.mjs'

/**
 * 假 settings 服务（0.1.7-alpha 线，SettingsForms 形状）：只承载本插件用到的
 * `configure(presentation, owner)`，并复刻真件的重复保护（同一 fiber 第二次
 * configure 抛错——disposer 必须先跑）。
 */
function makeFakeForms() {
  /** @type {Array<{presentation: {auto?: boolean}, owner: unknown}>} */
  const presentations = []
  const service = {
    configure(/** @type {{auto?: boolean}} */ presentation, /** @type {unknown} */ owner) {
      if (presentations.some((row) => row.owner === owner)) {
        throw new Error('Settings presentation is already configured for this plugin instance')
      }
      const row = { presentation, owner }
      presentations.push(row)
      return () => {
        const index = presentations.indexOf(row)
        if (index >= 0) presentations.splice(index, 1)
      }
    },
  }
  return { service, presentations }
}

/**
 * 假 settings 服务（旧线，installSection 形状）：register 语义对齐
 * @deepseek-ai/dsh-settings 的 alpha.3/alpha.4 与宿主内置副本的共同面。
 * current = 组合层 + 用户层浅覆盖；publish 模拟一次用户写入提交。
 * @param {object} [userLayer] - settings.yaml 用户层（相对组合层的覆盖）。
 */
function makeFakeLegacySettings(userLayer = {}) {
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
    panel: { enabled: true },
    ...overrides,
  }
}

/**
 * 0.1.7-alpha 线的 config 形态：每个 volatile 字段是一个 `{get()}` 实时引用
 * （`enabled` 是普通字段——它不在可编辑面上），Loader 把编辑提交进引用本身
 * 而不是重挂 fiber。字段集合与默认值取自 `Config` 本身，复刻 Loader 的
 * 「先按 schema 解析补默认，再给每个 volatile 字段一个引用」。`commit` 复刻那次
 * 提交，`emitVolatileUpdate` 复刻 Loader 随后向宿主 fiber 发的通知。
 * @param {object} values - 普通值 config。
 * @returns {{config: object, commit: (patch: object) => void}} 实时 config 与「提交一次编辑」。
 */
function makeLiveConfig(values) {
  /** 引用 → 普通值（Loader 解析后的字段值是引用，快照是普通值）。 */
  const unwrap = (/** @type {any} */ value) => (typeof value?.get === 'function' ? unwrap(value.get()) : value)
  const parsed = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (Config(values)))
  const state = /** @type {Record<string, unknown>} */ ({})
  for (const [key, value] of Object.entries(parsed)) state[key] = unwrap(value)
  /** @type {Record<string, unknown>} */
  const config = { enabled: state.enabled }
  for (const key of Object.keys(state)) {
    if (key === 'enabled') continue
    config[key] = { get: () => state[key] }
  }
  return {
    config,
    commit(/** @type {object} */ patch) {
      Object.assign(state, patch)
    },
  }
}

/**
 * 标准装载（默认挂 webServer 捕获路由），返回待清理组合。
 * @param {object} [opts] - {userLayer, composed, withSettings, live}。
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
  const values = composedOptions(dir, opts.composed)
  const live = makeLiveConfig(values)
  const settings = opts.legacy === true ? makeFakeLegacySettings(opts.userLayer) : makeFakeForms()
  if (opts.withSettings !== false) mock.ctx.provide('settings', settings.service)
  apply(mock.ctx, opts.live === true ? live.config : values)
  const teardown = () => {
    mock.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
  return { mock, live, settings, routes, teardown }
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

// ── 可编辑面（契约的形状断言）────────────────────────────────────────────

test('可编辑面：Config 的 volatile 字段恰好是旧面板的用户面，enabled 保持普通字段', () => {
  const fields = /** @type {Record<string, {meta?: {volatile?: boolean}}>} */ (/** @type {unknown} */ (Config)).dict
  const editable = Object.entries(fields).filter(([, schema]) => schema.meta?.volatile === true).map(([key]) => key)
  assert.deepEqual(editable.sort(), [
    'auditRetentionDays', 'budgets', 'commandAuditLimit', 'commandListLimit', 'dbPath',
    'language', 'maxEntriesPerQuery', 'panel', 'panelAuditLimit', 'panelEntriesLimit',
    'proposals', 'recall', 'retrieval', 'snapshotOrder', 'writePolicies', 'writePolicy',
  ])
  // enabled 是组合面开关：旧线同样不在设置面板里（false 时插件整体卸载）。
  assert.equal(fields.enabled.meta?.volatile, undefined)
  assert.equal(fields.panel.meta?.volatile, true, 'panel.enabled 旧线上就是可编辑字段')
})

test('可编辑面：数值下限写进 schema，越界编辑在持久化前被拒（不是等到下次加载）', () => {
  for (const [field, value] of [['maxEntriesPerQuery', 0], ['panelAuditLimit', -1], ['auditRetentionDays', -1], ['panelEntriesLimit', 3.5]]) {
    assert.throws(() => Config({ [field]: value }), (error) => {
      assert.match(String(error), new RegExp(field, 'u'))
      return true
    }, `${field}=${value} 必须被 schema 拒绝`)
  }
  // 合法边界仍然通过：下限 1（auditRetentionDays 允许 0）。volatile 字段的解析结果
  // 是实时引用，读值必须经 .get()（这正是 Loader 交给 apply 的形态）。
  assert.equal(Config({ maxEntriesPerQuery: 1 }).maxEntriesPerQuery.get(), 1)
  assert.equal(Config({ auditRetentionDays: 0 }).auditRetentionDays.get(), 0)
})

test('namespace：SETTINGS_ENTRY_ID 与 bundle patch 的行 id 一致', () => {
  const patch = readFileSync(path.join(import.meta.dirname, '..', 'cordis.patch.yml'), 'utf8')
  assert.match(patch, new RegExp(`^\\s*(?:-\\s*)?id:\\s*${SETTINGS_ENTRY_ID}\\s*$`, 'mu'))
  // 旧线 namespace 与 entry id 是两个不同的名字，不能互相顶替。
  assert.equal(SETTINGS_NAMESPACE, 'dsh-memento')
  assert.notEqual(SETTINGS_ENTRY_ID, SETTINGS_NAMESPACE)
})

// ── 0.1.7-alpha 线（live-config 契约）───────────────────────────────────

test('0.1.7 线：configure({auto:false}) 恰好一次，策略随卸载释放、随服务替换重注册', () => {
  const mounted = mount({ live: true })
  try {
    const { mock, settings } = mounted
    assert.equal(settings.presentations.length, 1, '自带设置页 ⇒ 恰一条呈现策略')
    assert.equal(settings.presentations[0].presentation.auto, false, 'auto:false = 不要生成重复表单')
    assert.equal(settings.presentations[0].owner, mock.ctx.fiber ?? settings.presentations[0].owner)
    // 服务替换：旧子 fiber 先释放（configure 对同一 fiber 会抛），随后在新服务上重注册。
    const replacement = makeFakeForms()
    mock.ctx.provide('settings', replacement.service)
    assert.equal(settings.presentations.length, 0, '旧服务上的策略必须已撤回')
    assert.equal(replacement.presentations.length, 1, '新服务上必须重新注册')
    assert.equal(replacement.presentations[0].presentation.auto, false)
    // 卸载：策略一并撤回（不留半残状态）。
    mock.dispose()
    assert.equal(replacement.presentations.length, 0)
  } finally {
    mounted.teardown()
  }
})

test('0.1.7 线：volatile 引用里的用户层在 store 打开前生效（启动期字段）', () => {
  const mounted = mount({ live: true, composed: { snapshotOrder: -70, language: 'en' } })
  try {
    const { mock } = mounted
    assert.equal(mock.sections.length, 1)
    assert.equal(mock.sections[0].order, -70)
    assert.equal(mock.ctx.get('memory').language, 'en')
  } finally {
    mounted.teardown()
  }
})

test('0.1.7 线：loader/volatile-update 让热字段即时生效，启动期字段留痕并要求重载', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-memento-settings-'))
  const mock = createMockCtx()
  try {
    const live = makeLiveConfig(composedOptions(dir))
    apply(mock.ctx, live.config)
    const service = mock.ctx.get('memory')
    assert.equal(service.language, 'zh')
    // 一次 volatile-only 提交：引用先变，Loader 随后发通知（不重挂 fiber）。
    live.commit({ language: 'en', writePolicy: 'off', dbPath: path.join(dir, 'moved.db') })
    assert.equal(service.language, 'zh', '通知之前不得自行生效（引用变了不等于已对账）')
    mock.ctx.emit('loader/volatile-update', [['language'], ['writePolicy'], ['dbPath']])
    assert.equal(service.language, 'en')
    assert.equal(service.writePolicy, 'off')
    const audit = service.store.auditList(10)
    const row = audit.find((entry) => entry.action === 'settings-startup-fields')
    assert.ok(row, '启动期字段变更必须响亮留痕')
    assert.match(row.text, /applied: .*dbPath\/auditRetentionDays/)
  } finally {
    mock.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('0.1.7 线：非法 live 值不生效且审计留痕（跨字段规则在 schema 之外，必须运行时挡）', () => {
  const mounted = mount({ live: true })
  try {
    const { mock, live } = mounted
    const service = mock.ctx.get('memory')
    assert.equal(service.language, 'zh')
    // writePolicies 的键文法无法用 schemastery 3.18.3 表达（没有 .check()），只能运行期拒。
    live.commit({ writePolicies: { 'no-such-key': 'auto' } })
    mock.ctx.emit('loader/volatile-update', [['writePolicies']])
    assert.equal(service.writePolicy, 'auto', '被拒的编辑不得改到运行面')
    const row = service.store.auditList(10).find((entry) => entry.action === 'settings-rejected')
    assert.ok(row, '被拒的实时编辑必须响亮留痕')
    assert.equal(row.outcome, 'error')
    assert.match(row.text, /writePolicies/)
  } finally {
    mounted.teardown()
  }
})

test('0.1.7 线：panel.enabled 随 volatile-update 透出到面板路由', () => {
  const mounted = mount({ live: true })
  try {
    const { mock, live, routes } = mounted
    const entries = routes.find((route) => route.path === '/api/memento/entries')
    assert.equal(callRoute(entries).panel.enabled, true)
    live.commit({ panel: { enabled: false } })
    mock.ctx.emit('loader/volatile-update', [['panel']])
    assert.equal(callRoute(entries).panel.enabled, false)
  } finally {
    mounted.teardown()
  }
})

test('0.1.7 线：retrieval.vector 热切换失败响亮留痕且不留半状态，恢复后重新启用', () => {
  const mounted = mount({ live: true, composed: { retrieval: { vector: true } } })
  try {
    const { mock, live } = mounted
    const registry = mock.ctx.get('memoryRetrieval')
    assert.deepEqual(registry.list().map((provider) => provider.id), ['substring', 'vector'])
    live.commit({ retrieval: { vector: false } })
    mock.ctx.emit('loader/volatile-update', [['retrieval']])
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
      live.commit({ retrieval: { vector: true } })
      mock.ctx.emit('loader/volatile-update', [['retrieval']])
    } finally {
      mock.ctx.effect = originalEffect
    }
    const failure = mock.ctx.get('memory').store.auditList(10).find((row) => row.action === 'settings-swap-failed')
    assert.ok(failure, '登记失败必须响亮留痕')
    assert.match(failure.text, /^retrieval\.vector: INACTIVE_EFFECT/)
    assert.deepEqual(registry.list().map((provider) => provider.id), ['substring'], '失败后不残留半注册')
    // 恢复：同一次热切换重试必须成功（插件没有被失败卡死）
    live.commit({ retrieval: { vector: true } })
    mock.ctx.emit('loader/volatile-update', [['retrieval']])
    assert.deepEqual(registry.list().map((provider) => provider.id), ['substring', 'vector'])
  } finally {
    mounted.teardown()
  }
})

// ── 旧线（installSection 形状分派）──────────────────────────────────────

test('旧线：installSection 以 dsh-memento 注册，启动期字段采用用户层', () => {
  const mounted = mount({ legacy: true, userLayer: { language: 'en', snapshotOrder: -70 } })
  try {
    const { mock, settings } = mounted
    assert.equal(settings.installs.length, 1)
    assert.equal(settings.installs[0].ns, 'dsh-memento')
    assert.equal(mock.sections.length, 1)
    assert.equal(mock.sections[0].order, -70)
    assert.equal(mock.ctx.get('memory').language, 'en')
  } finally {
    mounted.teardown()
  }
})

test('旧线：watch 热更——publish 后 writePolicy/language 即时生效', () => {
  const mounted = mount({ legacy: true })
  try {
    const { mock, settings } = mounted
    const service = mock.ctx.get('memory')
    assert.equal(service.writePolicy, 'auto')
    assert.equal(service.language, 'zh')
    settings.publish({ writePolicy: 'off', language: 'en' })
    assert.equal(service.writePolicy, 'off')
    assert.equal(service.language, 'en')
  } finally {
    mounted.teardown()
  }
})

test('旧线：panel 开关 publish 后 entries 路由透出 panel.enabled=false', () => {
  const mounted = mount({ legacy: true })
  try {
    const { settings, routes } = mounted
    const entries = routes.find((route) => route.path === '/api/memento/entries')
    assert.equal(callRoute(entries).panel.enabled, true)
    settings.publish({ panel: { enabled: false } })
    assert.equal(callRoute(entries).panel.enabled, false)
  } finally {
    mounted.teardown()
  }
})

test('旧线：settings 后到——热字段即时生效，启动期字段留痕并要求重载', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-memento-settings-'))
  const mock = createMockCtx()
  try {
    const settings = makeFakeLegacySettings({ language: 'en', dbPath: path.join(dir, 'moved.db') })
    apply(mock.ctx, composedOptions(dir))
    assert.equal(mock.ctx.get('memory').language, 'zh') // 服务未到前保持组合值
    mock.ctx.provide('settings', settings.service) // pendingInjects flush → 接线
    assert.equal(settings.installs.length, 1)
    assert.equal(mock.ctx.get('memory').language, 'en') // 热字段即时生效
    const audit = mock.ctx.get('memory').store.auditList(10)
    const row = audit.find((entry) => entry.action === 'settings-startup-fields')
    assert.ok(row)
    assert.match(row.text, /applied: .*dbPath\/auditRetentionDays/)
  } finally {
    mock.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('旧线：非法用户层值在注册时响亮拒绝（apply 抛错）', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-memento-settings-'))
  const mock = createMockCtx()
  try {
    const settings = makeFakeLegacySettings({ language: 'fr' })
    mock.ctx.provide('settings', settings.service)
    assert.throws(() => apply(mock.ctx, composedOptions(dir)), /language must be 'en' or 'zh'/)
  } finally {
    mock.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── 两线共用：服务缺失与生命周期 ────────────────────────────────────────

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
  const activateAndAssert = async (round, legacy) => {
    const mounted = mount({ live: !legacy, legacy, composed: { retrieval: { vector: true } } })
    const { mock, settings, routes } = mounted
    const registry = mock.ctx.get('memoryRetrieval')
    // ① 贡献恰一份（工具/快照段/面板路由/命令各自只有一份）
    assert.equal(mock.tools.length, 2, `第 ${round} 轮：memory + memory_recall 各一份`)
    assert.equal(mock.sections.length, 1, `第 ${round} 轮：快照段恰一份`)
    assert.equal(routes.length, 3, `第 ${round} 轮：面板只读路由恰三条`)
    // ② 订阅不重复（三个挂载期监听器各一条）
    assert.equal(mock.listeners.get('approval/request').length, 1, `第 ${round} 轮：审批 answerer 恰一条`)
    assert.equal(mock.listeners.get('session/event').length, 1, `第 ${round} 轮：会话事件监听恰一条`)
    // ③ 设置面只接线一次（新线 = 一条呈现策略，旧线 = 一次 namespace 注册）
    if (legacy) {
      assert.equal(settings.installs.length, 1, `第 ${round} 轮：dsh-memento 命名空间只注册一次`)
      assert.equal(settings.installs[0].ns, 'dsh-memento')
    } else {
      assert.equal(settings.presentations.length, 1, `第 ${round} 轮：呈现策略恰一条`)
    }
    // ④ 检索器注册面（含 vector：自持 disposer 的注册）齐全
    assert.deepEqual(registry.list().map((provider) => provider.id), ['substring', 'vector'], `第 ${round} 轮：两个检索器都在`)
    // ⑤ 重装后功能仍可用：写入 + 读回
    const service = mock.ctx.get('memory')
    await service.add({ track: 'user', scope: 'workspace', text: `第 ${round} 轮写入` }, { agent: makeAgent() })
    assert.equal(service.query({ text: `第 ${round} 轮写入` }).total, 1)
    // 关：卸载后服务、订阅目标、检索器注册与设置面全部下线（vector 不残留）
    mounted.teardown()
    assert.equal(mock.services.size, 0, `第 ${round} 轮卸载后：服务句柄零残留`)
    assert.deepEqual(registry.list(), [], `第 ${round} 轮卸载后：检索器注册零残留（含 vector）`)
    if (!legacy) assert.equal(settings.presentations.length, 0, `第 ${round} 轮卸载后：呈现策略零残留`)
  }
  await activateAndAssert(1, false)
  await activateAndAssert(2, false)
  await activateAndAssert(3, true)
})
