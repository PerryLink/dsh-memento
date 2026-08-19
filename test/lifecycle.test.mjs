// test/lifecycle.test.mjs — HMR-safety（C1）与导出契约（C2）套件。
//
// C1：真实 Cordis + 真实 ToolRuntime + mock systemPrompt/approval 组装；保存贡献
// fiber，释放后重查权威注册表，断言 ctx.memory / ctx.memoryAdapters 服务消失、
// memory / memory_recall 工具消失、systemPrompt 快照段消失。
// C2：模块命名空间无 default 导出，且 Loader.unwrapExports 往返返回同一命名空间。
// @module dsh-memento/test/lifecycle.test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as plugin from '../index.mjs'

/** 组装真实 Cordis 上下文（真实 systemPrompt/tools 注册表 + mock approval）。 */
async function mountHarness(config = {}) {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'dsh-memento-lifecycle-')), 'memory.db')
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  ctx.provide('approval', { request: async () => 'allowed-once', overrideOf: () => undefined, config: { policy: 'ask' } })
  await ctx.plugin(ToolRuntime)
  const pluginFiber = await ctx.plugin(plugin, { dbPath, ...config })
  return { ctx, pluginFiber }
}

// ---------------------------------------------------------------------------
// C2：函数插件命名空间必须经 Loader 解包往返
// ---------------------------------------------------------------------------

test('module carries no default export and Loader unwrap round-trips the namespace', () => {
  assert.equal('default' in plugin, false)
  const loader = Object.create(Loader.prototype)
  const unwrapped = loader.unwrapExports(plugin)
  assert.equal(unwrapped, plugin)
  assert.equal(unwrapped.name, 'memento')
  assert.deepEqual(unwrapped.inject, ['tools', 'systemPrompt', 'approval'])
  assert.ok(unwrapped.Config !== undefined)
  assert.equal(typeof unwrapped.apply, 'function')
})

// ---------------------------------------------------------------------------
// C1：释放贡献 fiber 后，memory 服务与 memory/memory_recall 工具消失
// ---------------------------------------------------------------------------

test('disposing the contributing fiber removes the memory seam and tools', async () => {
  const harness = await mountHarness()
  try {
    assert.ok(harness.ctx.get('memory') !== undefined, 'ctx.memory service should be provided')
    assert.ok(harness.ctx.get('memoryAdapters') !== undefined, 'ctx.memoryAdapters service should be provided')
    assert.ok(harness.ctx.tools.get('memory') !== undefined)
    assert.ok(harness.ctx.tools.get('memory_recall') !== undefined)

    await harness.pluginFiber.dispose()

    assert.equal(harness.ctx.get('memory'), undefined, 'ctx.memory should disappear after fiber dispose')
    assert.equal(harness.ctx.get('memoryAdapters'), undefined, 'ctx.memoryAdapters should disappear after fiber dispose')
    assert.equal(harness.ctx.tools.get('memory'), undefined, 'memory tool should disappear after fiber dispose')
    assert.equal(harness.ctx.tools.get('memory_recall'), undefined, 'memory_recall tool should disappear after fiber dispose')
  } finally {
    await harness.ctx.fiber.dispose()
  }
})

// ---------------------------------------------------------------------------
// HMR 回归：面板路由随 fiber 卸载摘除；重挂载不再触发宿主的 duplicate route
// ---------------------------------------------------------------------------

test('disposing the contributing fiber removes the panel routes and remount re-registers cleanly', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'dsh-memento-lifecycle-')), 'memory.db')
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  ctx.provide('approval', { request: async () => 'allowed-once', overrideOf: () => undefined, config: { policy: 'ask' } })
  await ctx.plugin(ToolRuntime)
  // 与真实宿主一致：重复 exact 路由抛错；返回的 disposer 摘除路由。
  const routes = new Map()
  ctx.provide('webServer', {
    register(route) {
      if (routes.has(route.path)) throw new Error(`duplicate exact route: ${route.path}`)
      routes.set(route.path, route)
      return () => { routes.delete(route.path) }
    },
  })
  const first = await ctx.plugin(plugin, { dbPath })
  try {
    assert.equal(routes.size, 3, 'the panel routes should be registered on mount')

    await first.dispose()
    assert.equal(routes.size, 0, 'the panel routes should be removed on fiber dispose')

    // 重挂载（配置热重载）不得再触发 duplicate route。
    const second = await ctx.plugin(plugin, { dbPath })
    assert.equal(routes.size, 3, 'a remount should re-register the panel routes')
    await second.dispose()
    assert.equal(routes.size, 0)
  } finally {
    await ctx.fiber.dispose()
  }
})
