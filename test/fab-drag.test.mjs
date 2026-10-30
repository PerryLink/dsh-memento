// test/fab-drag.test.mjs — 悬浮入口的拖动、位置记忆、视口夹取与双击复位。
// 客户端是 classic script，这里用 node:vm + 一个最小 DOM 桩驱动 installPanel 的真实分支。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'

const KEY = 'dsh.memento.fab.position.v1'

/** 最小 DOM 桩：足够 installPanel + 指针事件路径运行。 */
function makeDom() {
  const registry = new Map()
  const windowListeners = new Map()

  class FakeElement {
    constructor(tag) {
      this.tagName = tag
      this.id = ''
      this.style = {}
      this.dataset = {}
      this.children = []
      this.listeners = new Map()
      this._html = ''
      this._text = ''
      this.value = ''
      this.placeholder = ''
      this.title = ''
    }

    set textContent(value) { this._text = String(value) }
    get textContent() { return this._text }

    set innerHTML(value) {
      this._html = String(value)
      for (const match of this._html.matchAll(/id="([^"]+)"/g)) {
        const element = new FakeElement('div')
        element.id = match[1]
        registry.set(match[1], element)
      }
    }

    get innerHTML() { return this._html }

    appendChild(child) {
      this.children.push(child)
      if (child.id !== '') registry.set(child.id, child)
      return child
    }

    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, [])
      this.listeners.get(type).push(listener)
    }

    removeEventListener() {}
    setPointerCapture() {}
    releasePointerCapture() {}

    dispatch(type, event = {}) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener({
          preventDefault() {},
          pointerId: 1,
          button: 0,
          clientX: 0,
          clientY: 0,
          ...event,
        })
      }
    }

    getBoundingClientRect() {
      return {
        left: Number.parseFloat(this.style.left ?? '0') || 0,
        top: Number.parseFloat(this.style.top ?? '0') || 0,
        width: 96,
        height: 36,
      }
    }
  }

  const body = new FakeElement('body')
  const head = new FakeElement('head')
  const document = {
    getElementById: id => registry.get(id) ?? null,
    createElement: tag => new FakeElement(tag),
    head,
    body,
  }
  const window = {
    innerWidth: 390,
    innerHeight: 844,
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, [])
      windowListeners.get(type).push(listener)
    },
    __ModuleLoader__: { load(entry) { window.registered = entry } },
  }
  const storage = new Map()
  const localStorage = {
    getItem: key => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  }
  return { document, window, localStorage, storage, registry, windowListeners }
}

/** 载入 bundle 并挂载面板（panel.enabled=true）。 */
async function mountPanel({ storageSeed } = {}) {
  const dom = makeDom()
  if (storageSeed !== undefined) dom.localStorage.setItem(KEY, storageSeed)
  const sandbox = {
    fetch: async () => ({
      ok: true,
      json: async () => ({
        error: undefined,
        panel: { enabled: true },
        language: 'en',
        entries: [],
        total: 0,
        budgets: {},
      }),
    }),
    document: dom.document,
    window: dom.window,
    localStorage: dom.localStorage,
    console,
    setTimeout,
    clearTimeout,
    setImmediate,
  }
  createContext(sandbox)
  runInContext(readFileSync(new URL('../client/client.js', import.meta.url), 'utf8'), sandbox, { filename: 'client/client.js' })
  const entry = dom.window.registered
  assert.ok(entry, 'bundle must register through window.__ModuleLoader__.load')
  const client = entry.factory(() => ({ createElement: () => null }))
  const ctx = {
    effect(callback) { return callback() },
    slots: { inject() { return () => {} }, register(options) { return options } },
    // 拖拽测试不关心设置卡片，但 apply 恒挂卡片：给一个最小 ConfigForm 替身。
    configForms: {
      get() {
        return {
          getSnapshot: () => ({ status: 'ready', value: { language: 'en', writePolicy: 'ask', writePolicies: {}, dbPath: '', budgets: { user: { userGlobal: 2000, workspace: 2000 }, agent: { userGlobal: 4000, workspace: 4000 } }, panel: { enabled: true } }, user: {}, base: {}, writable: true }),
          subscribe: () => () => {},
          set: async () => false,
        }
      },
    },
  }
  client.apply(ctx)
  await new Promise(resolve => setImmediate(resolve))
  const button = dom.document.getElementById('mem-open')
  assert.ok(button, 'panel must render the floating entry')
  return { dom, button }
}

test('restores a stored position on mount', async () => {
  const { button } = await mountPanel({ storageSeed: JSON.stringify({ x: 120, y: 300 }) })
  assert.equal(button.style.left, '120px')
  assert.equal(button.style.top, '300px')
  assert.equal(button.dataset.positioned, '1')
})

test('drags, persists the position, and suppresses the click', async () => {
  const { dom, button } = await mountPanel({ storageSeed: JSON.stringify({ x: 120, y: 300 }) })
  button.dispatch('pointerdown', { clientX: 140, clientY: 320 })
  button.dispatch('pointermove', { clientX: 170, clientY: 350 })
  button.dispatch('pointerup', { clientX: 170, clientY: 350 })
  assert.equal(button.style.left, '150px')
  assert.equal(button.style.top, '330px')
  assert.deepEqual(JSON.parse(dom.localStorage.getItem(KEY)), { x: 150, y: 330 })
  const drawer = dom.document.getElementById('mem-drawer')
  assert.equal(drawer.style.display, 'none')
  button.dispatch('click')
  assert.equal(drawer.style.display, 'none', 'the click after a drag must not open the drawer')
})

test('clamps a drag into the viewport', async () => {
  const { button } = await mountPanel({ storageSeed: JSON.stringify({ x: 120, y: 300 }) })
  button.dispatch('pointerdown', { clientX: 120, clientY: 300 })
  button.dispatch('pointermove', { clientX: -400, clientY: -400 })
  button.dispatch('pointerup', { clientX: -400, clientY: -400 })
  assert.equal(button.style.left, '8px')
  assert.equal(button.style.top, '8px')
})

test('re-clamps a stored position when the viewport shrinks', async () => {
  const { dom, button } = await mountPanel({ storageSeed: JSON.stringify({ x: 280, y: 80 }) })
  dom.window.innerWidth = 200
  dom.window.innerHeight = 120
  for (const listener of dom.windowListeners.get('resize') ?? []) listener()
  assert.equal(button.style.left, '96px', '200 - 96 - 8')
  assert.equal(button.style.top, '76px', '120 - 36 - 8')
})

test('does not swallow a later click when the drag produced no click', async () => {
  const { dom, button } = await mountPanel({ storageSeed: JSON.stringify({ x: 120, y: 300 }) })
  button.dispatch('pointerdown', { clientX: 140, clientY: 320 })
  button.dispatch('pointermove', { clientX: 170, clientY: 350 })
  button.dispatch('pointerup', { clientX: 170, clientY: 350 })
  await new Promise(resolve => setTimeout(resolve, 0))
  const drawer = dom.document.getElementById('mem-drawer')
  button.dispatch('click')
  assert.equal(drawer.style.display, 'flex', 'a later click must still open the drawer')
})

test('double-click resets to the CSS default and clears storage', async () => {
  const { dom, button } = await mountPanel({ storageSeed: JSON.stringify({ x: 120, y: 300 }) })
  button.dispatch('dblclick')
  assert.equal(button.style.left, '')
  assert.equal(button.style.top, '')
  assert.equal(button.dataset.positioned, undefined)
  assert.equal(dom.localStorage.getItem(KEY), null)
})
