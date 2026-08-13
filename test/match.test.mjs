// test/match.test.mjs — 唯一子串匹配单测：零命中/多命中歧义/恰一命中。

import test from 'node:test'
import assert from 'node:assert/strict'
import { findUniqueMatch, requireUniqueMatch } from '../lib/match.mjs'
import { EntryNotFoundError, AmbiguousMatchError } from '../lib/errors.mjs'

function entry(id, text) {
  return { id, text }
}

const ENTRIES = [
  entry('a', '用户偏好：回复用中文'),
  entry('b', '用户偏好：代码注释用英文'),
  entry('c', '项目约定：测试先于实现'),
]

test('恰一命中返回条目', () => {
  const result = findUniqueMatch(ENTRIES, '代码注释')
  assert.equal(result.kind, 'ok')
  assert.equal(result.entry.id, 'b')
})

test('零命中返回 not-found（大小写敏感）', () => {
  assert.deepEqual(findUniqueMatch(ENTRIES, '不存在的短语'), { kind: 'not-found' })
  assert.equal(findUniqueMatch(ENTRIES, '用户偏好').kind, 'ambiguous') // 两条含它
})

test('多命中返回 ambiguous 并携带全部候选', () => {
  const result = findUniqueMatch(ENTRIES, '用户偏好')
  assert.equal(result.kind, 'ambiguous')
  assert.equal(result.candidates.length, 2)
  assert.deepEqual(result.candidates.map((candidate) => candidate.id).sort(), ['a', 'b'])
})

test('requireUniqueMatch 把歧义/未命中转成带上下文的领域错误', () => {
  const ctx = { track: 'user', scope: 'user-global', match: '用户偏好' }
  assert.throws(
    () => requireUniqueMatch(findUniqueMatch(ENTRIES, '用户偏好'), ctx, { EntryNotFoundError, AmbiguousMatchError }),
    (error) => error instanceof AmbiguousMatchError
      && error.code === 'AMBIGUOUS_MATCH'
      && error.details.candidates === 2
      && Array.isArray(error.details.sample)
      && error.message.includes('longer, unique substring'),
  )
  assert.throws(
    () => requireUniqueMatch(findUniqueMatch(ENTRIES, 'nothing'), { ...ctx, match: 'nothing' }, { EntryNotFoundError, AmbiguousMatchError }),
    (error) => error instanceof EntryNotFoundError && error.details.match === 'nothing',
  )
})

test('requireUniqueMatch 命中时返回条目本体', () => {
  const got = requireUniqueMatch(findUniqueMatch(ENTRIES, '测试先于实现'), { track: 'agent', scope: 'workspace', match: '测试先于实现' }, { EntryNotFoundError, AmbiguousMatchError })
  assert.equal(got.id, 'c')
})
