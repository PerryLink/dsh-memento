// test/coverage-report.test.mjs — 覆盖率报告解析器 fixture 测试。
//
// 锁定 parseReport 对 Node 22（'# ' 前缀）与 Node 24（'ℹ ' 前缀 + start/end/tests
// 标记行）两种 node --test --experimental-test-coverage 报告格式的解析行为，
// 防止未来 Node 版本改格式时覆盖率门静默变红。fixture 为合成文本，无真实数据。

import test from 'node:test'
import assert from 'node:assert/strict'
import { parseReport } from '../scripts/check-coverage.mjs'

test('parseReport：Node 22 格式（# 前缀、分组嵌套、表头）', () => {
  const stdout = [
    '# start of coverage report',
    '# file           | line % | branch % | funcs % | uncovered lines',
    '# all files      |  96.31 |    84.59 |   87.25 | ',
    '# lib            |         |          |         | ',
    '#  budget.mjs    | 100.00  |   100.00 |  100.00 | ',
    '#  store.mjs     |  97.55  |    90.00 |   95.00 | 12-14',
    '# index.mjs      |  94.70  |    79.54 |   79.51 | 438',
    '# end of coverage report',
    '# tests 112',
    '# pass 112',
  ].join('\n')
  const { rows, sawAny } = parseReport(stdout)
  assert.equal(sawAny, true)
  assert.deepEqual(rows, [
    { qualified: 'all files', line: 96.31 },
    { qualified: 'lib/budget.mjs', line: 100 },
    { qualified: 'lib/store.mjs', line: 97.55 },
    { qualified: 'index.mjs', line: 94.7 },
  ])
})

test('parseReport：Node 24 格式（ℹ 前缀、start/end/tests 标记行）', () => {
  const stdout = [
    'ℹ tests 112',
    'ℹ pass 112',
    'ℹ start of coverage report',
    'ℹ file           | line % | branch % | funcs % | uncovered lines',
    'ℹ all files      |  96.31 |    84.59 |   87.25 | ',
    'ℹ index.mjs      |  94.70 |    79.54 |   79.51 | 438-439 538-539',
    'ℹ lib            |         |          |         | ',
    'ℹ  budget.mjs    | 100.00  |   100.00 |  100.00 | ',
    'ℹ  store.mjs     |  97.55  |    90.00 |   95.00 | 12-14',
    'ℹ end of coverage report',
  ].join('\n')
  const { rows, sawAny } = parseReport(stdout)
  assert.equal(sawAny, true)
  assert.deepEqual(rows, [
    { qualified: 'all files', line: 96.31 },
    { qualified: 'index.mjs', line: 94.7 },
    { qualified: 'lib/budget.mjs', line: 100 },
    { qualified: 'lib/store.mjs', line: 97.55 },
  ])
})

test('parseReport：两种格式都不认识时 sawAny=false（门响亮失败而非静默放行）', () => {
  const { rows, sawAny } = parseReport('some totally unrelated output\nno table here\n')
  assert.equal(sawAny, false)
  assert.deepEqual(rows, [])
})
