// test/fixtures.test.mjs — 夹具自检：合成数据形状与确定性（可跨平台重放）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { TYPICAL_ENTRIES, AMBIGUOUS_ENTRIES, assertFixtureShape, makeEntries } from './helpers/fixtures.mjs'
import { renderSnapshot } from '../lib/snapshot.mjs'
import { entryUsage } from '../lib/budget.mjs'

test('夹具自检：形状完整、无真实用户数据', () => {
  assertFixtureShape(TYPICAL_ENTRIES)
  assertFixtureShape(AMBIGUOUS_ENTRIES)
  for (const entry of TYPICAL_ENTRIES) {
    assert.equal(entry.source, 'fixture')
    assert.equal(entry.sessionId, null)
  }
})

test('夹具可确定重放：同一数据集渲染同一快照（含用量头）', () => {
  const budgets = { user: { userGlobal: 2000, workspace: 2000 }, agent: { userGlobal: 4000, workspace: 4000 } }
  const first = renderSnapshot(TYPICAL_ENTRIES, budgets)
  const second = renderSnapshot(TYPICAL_ENTRIES, budgets)
  assert.equal(first, second)
  const userGlobal = entryUsage(TYPICAL_ENTRIES, 'user', 'user-global')
  const agentWorkspace = entryUsage(TYPICAL_ENTRIES, 'agent', 'workspace')
  assert.ok(first.includes(`User profile (global preferences, communication style, landmines) — ${userGlobal}/2000 chars used`))
  assert.ok(first.includes(`Workspace facts, conventions, and lessons — ${agentWorkspace}/4000 chars used`))
})

test('歧义夹具：两个条目共享同一子串前缀', () => {
  const texts = AMBIGUOUS_ENTRIES.map((entry) => entry.text)
  assert.equal(texts.every((text) => text.includes('偏好中文')), true)
})

test('makeEntries 时间戳严格递增（排序确定）', () => {
  const entries = makeEntries([
    { id: 'x', track: 'user', scope: 'user-global', text: 'x' },
    { id: 'y', track: 'user', scope: 'user-global', text: 'y' },
  ])
  assert.ok(entries[0].createdAt < entries[1].createdAt)
})
