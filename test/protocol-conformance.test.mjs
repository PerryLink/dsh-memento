// test/protocol-conformance.test.mjs — 一致性套件的仓库门：黄金参考全绿。
//
// 任何声称兼容 dsh-memory-protocol v1 的 Provider 都跑同一套用例；本仓库 CI
// 以自己的 Provider（lib/store.mjs + MemoryProtocolCore）作为黄金参考——
// 这是"协议声称"的自我证明。套件实现见 test/protocol-conformance/。

import test from 'node:test'
import assert from 'node:assert/strict'
import { runConformance } from './protocol-conformance/run.mjs'
import { makeProvider } from './protocol-conformance/golden.mjs'
import { PROTOCOL_URI, validateMemoryEntry, validateExportEnvelope, validateAuditRow, normalizeTags, MAX_TAGS_PER_ENTRY, MAX_TAG_LENGTH } from '../lib/protocol.mjs'
import { InvalidInputError } from '../lib/errors.mjs'

test('一致性套件：黄金参考 Provider 全绿（协议自证）', async () => {
  const report = await runConformance(makeProvider)
  assert.equal(report.protocol, PROTOCOL_URI)
  assert.equal(report.total, 22)
  assert.equal(report.failed, 0, `conformance failures: ${JSON.stringify(report.results.filter((result) => result.status === 'fail'))}`)
})

test('协议校验函数：validateMemoryEntry 接受黄金条目并拒绝伪造形状', () => {
  const valid = {
    id: '123e4567-e89b-42d3-a456-426614174000',
    track: 'user',
    scope: 'user-global',
    workspaceKey: '',
    agentKey: '',
    text: '合法条目',
    source: 'test',
    tags: ['a'],
    version: 1,
    createdAt: 1000,
    updatedAt: 2000,
    lastRecalled: null,
    recallCount: 0,
    sessionId: null,
  }
  assert.equal(validateMemoryEntry(valid).text, '合法条目')
  assert.throws(() => validateMemoryEntry({ ...valid, id: 'not-a-uuid' }), InvalidInputError)
  assert.throws(() => validateMemoryEntry({ ...valid, version: 0 }), InvalidInputError)
  assert.throws(() => validateMemoryEntry({ ...valid, track: 'team' }), InvalidInputError)
  assert.throws(() => validateMemoryEntry({ ...valid, updatedAt: 500 }), InvalidInputError)
  assert.throws(() => validateMemoryEntry({ ...valid, tags: 'not-an-array' }), InvalidInputError)
})

test('协议校验函数：validateExportEnvelope 信封往返与拒绝', () => {
  const envelope = {
    plugin: 'dsh-memento',
    schema: 'memory-export-v1',
    exportedAt: new Date().toISOString(),
    budgets: [{ track: 'user', scope: 'user-global', used: 0, limit: 2000 }],
    entries: [],
  }
  assert.equal(validateExportEnvelope(envelope).entries.length, 0)
  assert.throws(() => validateExportEnvelope({ ...envelope, schema: 'memory-export-v2' }), InvalidInputError)
  assert.throws(() => validateExportEnvelope({ ...envelope, budgets: 'x' }), InvalidInputError)
})

test('协议校验函数：validateAuditRow 接受审计行并拒绝非法字段', () => {
  const row = { seq: 1, ts: 1000, action: 'add', track: 'user', scope: 'user-global', entryId: null, text: 'x', outcome: 'ok', source: 't', sessionId: null }
  assert.equal(validateAuditRow(row).action, 'add')
  assert.throws(() => validateAuditRow({ ...row, seq: 'x' }), InvalidInputError)
  assert.throws(() => validateAuditRow({ ...row, action: '' }), InvalidInputError)
  assert.throws(() => validateAuditRow({ ...row, entryId: 5 }), InvalidInputError)
})

test('协议校验函数：normalizeTags 边界（上限常量与去重顺序）', () => {
  assert.deepEqual(normalizeTags(undefined), [])
  assert.deepEqual(normalizeTags(['b', ' a ', 'a', 'b']), ['b', 'a'])
  assert.equal(MAX_TAGS_PER_ENTRY, 16)
  assert.equal(MAX_TAG_LENGTH, 32)
  assert.throws(() => normalizeTags('x'), InvalidInputError)
  assert.throws(() => normalizeTags(['']), InvalidInputError)
  assert.throws(() => normalizeTags([1]), InvalidInputError)
})
