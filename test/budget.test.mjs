// test/budget.test.mjs — 预算纯逻辑单测：溢出、报表、配置校验。

import test from 'node:test'
import assert from 'node:assert/strict'
import { entryUsage, usageRows, checkBudget, budgetReport, budgetLimits, validateBudgets } from '../lib/budget.mjs'

const BUDGETS = {
  user: { userGlobal: 2000, workspace: 2000 },
  agent: { userGlobal: 4000, workspace: 4000 },
}

function entry(track, scope, text) {
  return { track, scope, text }
}

test('entryUsage 只统计同 track+scope 的字符数（中文计 1 个字符）', () => {
  const entries = [
    entry('user', 'user-global', 'abc'),
    entry('user', 'user-global', '你好'), // 2 个字符，非 6 字节
    entry('user', 'workspace', 'xyz'),
    entry('agent', 'user-global', 'big'),
  ]
  assert.equal(entryUsage(entries, 'user', 'user-global'), 5)
  assert.equal(entryUsage(entries, 'user', 'workspace'), 3)
  assert.equal(entryUsage(entries, 'agent', 'workspace'), 0)
})

test('checkBudget 恰好等于上限放行，超过则报 ok:false 并带用量事实', () => {
  assert.deepEqual(checkBudget(90, 100, 10), { ok: true })
  assert.deepEqual(checkBudget(90, 100, 11), { ok: false, used: 90, limit: 100, needed: 101 })
  // replace 净变化可为负
  assert.deepEqual(checkBudget(90, 100, -50), { ok: true })
})

test('budgetReport 覆盖全部 4 组并带正确上限', () => {
  const entries = [entry('user', 'user-global', 'abc'), entry('agent', 'workspace', 'efgh')]
  assert.deepEqual(budgetReport(entries, BUDGETS), [
    { track: 'user', scope: 'user-global', used: 3, limit: 2000 },
    { track: 'user', scope: 'workspace', used: 0, limit: 2000 },
    { track: 'agent', scope: 'user-global', used: 0, limit: 4000 },
    { track: 'agent', scope: 'workspace', used: 4, limit: 4000 },
  ])
})

test('budgetLimits 把 userGlobal/workspace 键映射为作用域键', () => {
  assert.deepEqual(budgetLimits(BUDGETS), {
    user: { 'user-global': 2000, workspace: 2000 },
    agent: { 'user-global': 4000, workspace: 4000 },
  })
})

test('usageRows 输出稳定顺序（user→agent × user-global→workspace）', () => {
  assert.deepEqual(usageRows([]).map((row) => `${row.track}/${row.scope}`), [
    'user/user-global', 'user/workspace', 'agent/user-global', 'agent/workspace',
  ])
})

test('validateBudgets 接受合法配置并拒绝非法上限（响亮失败）', () => {
  assert.equal(validateBudgets(BUDGETS).ok, true)
  for (const bad of [
    null,
    {},
    { user: { userGlobal: 100, workspace: 100 } },
    { user: { userGlobal: 100, workspace: 100 }, agent: { userGlobal: -1, workspace: 100 } },
    { user: { userGlobal: 100, workspace: 100 }, agent: { userGlobal: 100, workspace: 0 } },
    { user: { userGlobal: 100, workspace: 100 }, agent: { userGlobal: 100, workspace: 1.5 } },
    { user: { userGlobal: '100', workspace: 100 }, agent: { userGlobal: 100, workspace: 100 } },
  ]) {
    const result = validateBudgets(bad)
    assert.equal(result.ok, false, `expected rejection: ${JSON.stringify(bad)}`)
    assert.equal(typeof result.message, 'string')
  }
})
