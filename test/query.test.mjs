// test/query.test.mjs — 查询词项化 / 多词匹配 / 词频打分 单测（零依赖模块）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { tokenizeQuery, countOccurrences, matchQuery, scoreEntry } from '../lib/query.mjs'

test('tokenizeQuery：英文按空白/标点切、小写、去重保序', () => {
  assert.deepEqual(tokenizeQuery('dark mode'), ['dark', 'mode'])
  assert.deepEqual(tokenizeQuery('Dark, MODE!'), ['dark', 'mode'])
  assert.deepEqual(tokenizeQuery('a a b A'), ['a', 'b'])
  assert.deepEqual(tokenizeQuery('   '), [])
  assert.deepEqual(tokenizeQuery(''), [])
  assert.deepEqual(tokenizeQuery(null), [])
})

test('tokenizeQuery：连续 CJK 段整体当一个词项', () => {
  assert.deepEqual(tokenizeQuery('用户偏好'), ['用户偏好'])
  assert.deepEqual(tokenizeQuery('用户偏好 代码注释'), ['用户偏好', '代码注释'])
  assert.deepEqual(tokenizeQuery('中文，English 混合'), ['中文', 'english', '混合'])
})

test('tokenizeQuery：纯标点/符号查询 → 空词项', () => {
  assert.deepEqual(tokenizeQuery('!!!???...'), [])
  assert.deepEqual(tokenizeQuery('——、；'), [])
})

test('countOccurrences：非重叠计数、空 needle 为 0', () => {
  assert.equal(countOccurrences('a a a', 'a'), 3)
  assert.equal(countOccurrences('aaaa', 'aa'), 2)
  assert.equal(countOccurrences('abc', 'z'), 0)
  assert.equal(countOccurrences('abc', ''), 0)
})

test('matchQuery：全部词项出现（AND、顺序无关、大小写不敏感）', () => {
  const text = 'favorite drink is lapsang souchong'
  assert.equal(matchQuery(text, ['lapsang', 'drink']), true)
  assert.equal(matchQuery(text, ['drink', 'lapsang']), true, '顺序无关')
  assert.equal(matchQuery(text, ['LAPSANG']), true, '大小写不敏感')
  assert.equal(matchQuery(text, ['lapsang', 'tea']), false, '缺词项不命中')
  assert.equal(matchQuery(text, []), false, '空词项不命中')
})

test('scoreEntry：任一词项缺失 → null；全命中 → 数值', () => {
  const text = 'dark mode enabled'
  assert.notEqual(scoreEntry(text, ['dark', 'mode']), null)
  assert.equal(scoreEntry(text, ['dark', 'nope']), null)
})

test('scoreEntry：词频高 / 短语连续 得分更高', () => {
  const base = scoreEntry('dark mode', ['dark', 'mode'], 'dark mode')
  const repeated = scoreEntry('dark mode dark mode dark', ['dark', 'mode'], 'dark mode')
  const scattered = scoreEntry('dark filler mode', ['dark', 'mode'], 'dark mode')
  assert.ok(repeated > base, '词频高应更高')
  assert.ok(base > scattered, '短语连续应高于分散出现')
})

test('scoreEntry：CJK 多词项', () => {
  assert.notEqual(scoreEntry('用户偏好：回复用中文', ['用户偏好', '中文']), null)
  assert.equal(scoreEntry('用户偏好：回复用中文', ['用户偏好', '英文']), null)
})
