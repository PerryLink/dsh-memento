// test/snapshot.test.mjs — 冻结快照渲染单测：分组/排序/用量头/空态/可见性。

import test from 'node:test'
import assert from 'node:assert/strict'
import { renderSnapshot, visibleEntries } from '../lib/snapshot.mjs'

const BUDGETS = {
  user: { userGlobal: 2000, workspace: 2000 },
  agent: { userGlobal: 4000, workspace: 4000 },
}

function entry(partial) {
  return {
    id: partial.id ?? 'id',
    track: partial.track,
    scope: partial.scope,
    workspaceKey: partial.workspaceKey ?? '',
    agentKey: partial.agentKey ?? '',
    text: partial.text,
    source: 'test',
    createdAt: partial.createdAt ?? 0,
    updatedAt: 0,
    sessionId: null,
  }
}

test('无条目时渲染空串（空段不进提示词，零 token 成本）', () => {
  assert.equal(renderSnapshot([], BUDGETS), '')
})

test('快照含冻结说明、每组用量头与条目文本', () => {
  const entries = [
    entry({ id: 'u1', track: 'user', scope: 'user-global', text: '偏好中文回复' }),
    entry({ id: 'a1', track: 'agent', scope: 'workspace', text: '测试先于实现', workspaceKey: '/w' }),
  ]
  const text = renderSnapshot(entries, BUDGETS)
  assert.ok(text.startsWith('[dsh-memento: frozen memory snapshot'), '应带冻结说明头')
  assert.ok(text.includes('User profile (global preferences, communication style, landmines) — 6/2000 chars used'), 'user-global 组应带用量头 6/2000')
  assert.ok(text.includes('Workspace facts, conventions, and lessons — 6/4000 chars used'), 'agent/workspace 组应带用量头 6/4000')
  assert.ok(text.includes('- 偏好中文回复'))
  assert.ok(text.includes('- 测试先于实现'))
})

test('同一组内按创建时间升序（旧事实在前）', () => {
  const entries = [
    entry({ id: 'b', track: 'user', scope: 'user-global', text: 'newer', createdAt: 2 }),
    entry({ id: 'a', track: 'user', scope: 'user-global', text: 'older', createdAt: 1 }),
  ]
  const text = renderSnapshot(entries, BUDGETS)
  assert.ok(text.indexOf('- older') < text.indexOf('- newer'))
})

test('空组不渲染（不浪费 token）', () => {
  const entries = [entry({ id: 'a', track: 'user', scope: 'user-global', text: 'x' })]
  const text = renderSnapshot(entries, BUDGETS)
  assert.ok(!text.includes('User preferences for this workspace'))
  assert.ok(!text.includes('Workspace facts'))
})

test('visibleEntries：user-global 全见；workspace 只匹配 workspaceKey', () => {
  const entries = [
    entry({ id: 'g', track: 'user', scope: 'user-global', text: 'global' }),
    entry({ id: 'w1', track: 'agent', scope: 'workspace', text: 'mine', workspaceKey: '/w' }),
    entry({ id: 'w2', track: 'user', scope: 'workspace', text: 'other', workspaceKey: '/other' }),
  ]
  const visible = visibleEntries(entries, '/w')
  assert.deepEqual(visible.map((v) => v.id).sort(), ['g', 'w1'])
})

test('visibleEntries：agentKey 共享层全见，专属层只匹配会话 agentKey', () => {
  const entries = [
    entry({ id: 'shared', track: 'user', scope: 'user-global', text: 'shared', agentKey: '' }),
    entry({ id: 'mine', track: 'user', scope: 'user-global', text: 'mine', agentKey: 'preset-a' }),
    entry({ id: 'other', track: 'user', scope: 'user-global', text: 'other', agentKey: 'preset-b' }),
  ]
  assert.deepEqual(visibleEntries(entries, '/w', 'preset-a').map((v) => v.id).sort(), ['mine', 'shared'])
  assert.deepEqual(visibleEntries(entries, '/w', '').map((v) => v.id), ['shared'], '无 preset 的会话只见共享层')
})
