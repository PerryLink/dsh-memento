// test/gate.test.mjs — 审批门策略单测：认领判定、reason 往返、三策略裁决。

import test from 'node:test'
import assert from 'node:assert/strict'
import { isMemoryWriteRequest, buildWriteReason, parseWriteReason, applyWritePolicy, normalizeWritePolicy, resolveWritePolicy, validateWritePolicies } from '../lib/gate.mjs'
import { InvalidInputError } from '../lib/errors.mjs'

test('isMemoryWriteRequest 只认领 toolName=memory 且带 [dsh-memento] 前缀的请求', () => {
  const ours = { toolName: 'memory', reason: '[dsh-memento] add user/workspace\nhello' }
  assert.equal(isMemoryWriteRequest(ours), true)
  assert.equal(isMemoryWriteRequest({ toolName: 'memory', reason: 'generic tool ask' }), false)
  assert.equal(isMemoryWriteRequest({ toolName: 'bash', reason: '[dsh-memento] add user/workspace\nhello' }), false)
  assert.equal(isMemoryWriteRequest({ toolName: 'memory' }), false)
  assert.equal(isMemoryWriteRequest(null), false)
})

test('buildWriteReason 首行人类可读摘要，正文携带完整载荷；parse 可无损往返', () => {
  const reason = buildWriteReason({ action: 'add', track: 'user', scope: 'workspace', text: '偏好中文回复\n第二行' })
  assert.ok(reason.startsWith('[dsh-memento] add user/workspace\n'))
  assert.deepEqual(parseWriteReason(reason), { action: 'add', track: 'user', scope: 'workspace', text: '偏好中文回复\n第二行' })
  const seeded = buildWriteReason({ action: 'seed', track: 'batch', scope: 'batch', text: 'a\nb', count: 2 })
  assert.deepEqual(parseWriteReason(seeded), { action: 'seed', count: 2, track: 'batch', scope: 'batch', text: 'a\nb' })
  assert.equal(parseWriteReason('别的插件发来的 reason'), null)
})

test('applyWritePolicy：auto 直接放行（不打扰 answerer 链）', async () => {
  let nextCalled = false
  const outcome = await applyWritePolicy('auto', {}, async () => {
    nextCalled = true
    return 'unavailable'
  })
  assert.equal(outcome, 'allowed-once')
  assert.equal(nextCalled, false)
})

test('applyWritePolicy：off 直接拒绝（不打扰 answerer 链）', async () => {
  let nextCalled = false
  const outcome = await applyWritePolicy('off', {}, async () => {
    nextCalled = true
    return 'allowed-once'
  })
  assert.equal(outcome, 'rejected')
  assert.equal(nextCalled, false)
})

test('applyWritePolicy：ask 委托续链（用户 answerer 决定）', async () => {
  const seen = []
  const outcome = await applyWritePolicy('ask', {}, async () => {
    seen.push('chain')
    return 'allowed-once'
  })
  assert.equal(outcome, 'allowed-once')
  assert.deepEqual(seen, ['chain'])
})

test('applyWritePolicy：非法策略响亮失败', async () => {
  await assert.rejects(() => applyWritePolicy('maybe', {}, async () => 'unavailable'), InvalidInputError)
})

test('normalizeWritePolicy 接受三态并拒绝其它值', () => {
  assert.equal(normalizeWritePolicy('ask'), 'ask')
  assert.equal(normalizeWritePolicy('auto'), 'auto')
  assert.equal(normalizeWritePolicy('off'), 'off')
  assert.throws(() => normalizeWritePolicy('always'), InvalidInputError)
  assert.throws(() => normalizeWritePolicy(undefined), InvalidInputError)
})

test('reason 携带 source 时可无损往返（粒度策略裁决依据）', () => {
  const reason = buildWriteReason({ action: 'add', track: 'agent', scope: 'workspace', text: 'x', source: 'claude' })
  assert.ok(reason.includes('[source:claude]'))
  assert.deepEqual(parseWriteReason(reason), { action: 'add', track: 'agent', scope: 'workspace', source: 'claude', text: 'x' })
  const without = buildWriteReason({ action: 'add', track: 'user', scope: 'workspace', text: 'x' })
  assert.deepEqual(parseWriteReason(without), { action: 'add', track: 'user', scope: 'workspace', text: 'x' }, '无 source 时形状不变')
})

test('resolveWritePolicy：source 精确键 > track/scope 键 > 全局回退', () => {
  const table = { 'agent/user-global': 'auto', 'user/workspace': 'off', 'source:claude': 'auto' }
  assert.equal(resolveWritePolicy(table, 'ask', 'user', 'workspace', undefined), 'off', 'track/scope 键命中')
  assert.equal(resolveWritePolicy(table, 'ask', 'user', 'user-global', undefined), 'ask', '未命中回退全局')
  assert.equal(resolveWritePolicy(table, 'ask', 'user', 'workspace', 'claude'), 'auto', 'source 键优先于 track/scope')
  assert.equal(resolveWritePolicy({}, 'auto', 'user', 'workspace', undefined), 'auto', '空表纯回退（旧 Config 兼容）')
})

test('validateWritePolicies：合法键值通过，非法键/值加载期响亮', () => {
  assert.deepEqual(validateWritePolicies({ 'user/workspace': 'off', 'source:claude': 'auto' }), { 'user/workspace': 'off', 'source:claude': 'auto' })
  assert.throws(() => validateWritePolicies({ 'bad/key': 'ask' }), InvalidInputError)
  assert.throws(() => validateWritePolicies({ 'user/workspace': 'always' }), InvalidInputError)
  assert.throws(() => validateWritePolicies(null), InvalidInputError)
})
