// test/extract.test.mjs — 会话事件文本抽取单测（memory_recall 片段显示用）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { extractEventText } from '../lib/extract.mjs'

test('user/message 与 assistant/message 抽取 content 文本块', () => {
  const event = {
    type: 'user/message',
    data: { content: [{ type: 'text', text: '你好' }, { type: 'text', text: '第二段' }, { type: 'image' }] },
  }
  assert.equal(extractEventText(event), '你好\n第二段')
})

test('tool/call 抽取工具名+原始参数；tool/result 抽取 message 文本', () => {
  assert.equal(extractEventText({ type: 'tool/call', data: { name: 'memory', arguments: '{"action":"add"}' } }), 'memory {"action":"add"}')
  assert.equal(
    extractEventText({ type: 'tool/result', data: { message: { content: [{ type: 'text', text: '结果' }] } } }),
    '结果',
  )
})

test('todo/write 抽取清单；字符串 data 原样返回', () => {
  assert.equal(
    extractEventText({ type: 'todo/write', data: { todos: [{ content: '任务一', status: 'pending' }] } }),
    '任务一',
  )
  assert.equal(extractEventText({ type: 'x', data: 'raw text' }), 'raw text')
})

test('不认识的事件返回空串（绝不抛错）', () => {
  assert.equal(extractEventText({ type: 'turn/start', data: { turn: 1 } }), '')
  assert.equal(extractEventText({ type: 'x', data: { whatever: 1 } }), '')
  assert.equal(extractEventText(undefined), '')
})
