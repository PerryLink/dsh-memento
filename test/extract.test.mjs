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

test('assistant/message 含 reasoning 与 text：只抽可见 text，换行拼接不变', () => {
  const event = {
    type: 'assistant/message',
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: '内部推理甲' },
          { type: 'text', text: '可见第一段' },
          { type: 'tool-call', id: 'call-1', name: 'memory', arguments: '{"action":"add"}' },
          { type: 'reasoning', text: '内部推理乙' },
          { type: 'text', text: '可见第二段' },
          { type: 'image' },
        ],
      },
    },
  }
  assert.equal(extractEventText(event), '可见第一段\n可见第二段')
})

test('只有 reasoning 的 assistant 消息返回空串（思维链绝不进片段）', () => {
  assert.equal(
    extractEventText({
      type: 'assistant/message',
      data: { message: { role: 'assistant', content: [{ type: 'reasoning', text: '只有思维链' }] } },
    }),
    '',
  )
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
