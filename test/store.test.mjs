// test/store.test.mjs — SQLite Provider 单测：CRUD/唯一子串/审计/损坏响亮/路径解析。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openMemoryStore, resolveDbPath, chmodOwned } from '../lib/store.mjs'
import { SCHEMA_VERSION, ERROR_CODES } from '../lib/constants.mjs'
import { StoreError, InvalidInputError, EntryNotFoundError, AmbiguousMatchError, ProposalNotFoundError } from '../lib/errors.mjs'

/** 每次测试独立的临时库。 */
function tempStore() {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-memento-'))
  const store = openMemoryStore(path.join(dir, 'memory.db'))
  return { dir, store }
}

function closeAndClean({ dir, store }) {
  store.close()
  rmSync(dir, { recursive: true, force: true })
}

test('打开即建库：schema 版本落地，0600（POSIX）', (t) => {
  const { dir, store } = tempStore()
  t.after(() => closeAndClean({ dir, store }))
  const meta = store.db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version')
  assert.equal(Number(meta.value), SCHEMA_VERSION)
  if (process.platform !== 'win32') {
    const mode = statSync(store.path).mode & 0o777
    assert.equal(mode, 0o600)
  }
})

test('chmodOwned：POSIX 收紧主库与已存在边车为 0600，缺失边车跳过，win32 不动作', () => {
  const calls = []
  const chmod = (p, mode) => calls.push([p, mode])
  const exists = (p) => p.endsWith('-wal')
  chmodOwned('/d/memory.db', { platform: 'linux', chmod, exists })
  assert.deepEqual(calls, [['/d/memory.db', 0o600], ['/d/memory.db-wal', 0o600]])
  calls.length = 0
  chmodOwned('/d/memory.db', { platform: 'win32', chmod, exists })
  assert.deepEqual(calls, [])
})

test('insert/query/list：CRUD 基本行为与元数据', (t) => {
  const { dir, store } = tempStore()
  t.after(() => closeAndClean({ dir, store }))
  const entry = store.insertEntry({
    track: 'user', scope: 'workspace', workspaceKey: '/w', text: '偏好中文回复',
    source: 'claude', sessionId: 's1',
  })
  assert.equal(entry.track, 'user')
  assert.equal(entry.scope, 'workspace')
  assert.equal(entry.sessionId, 's1')
  assert.equal(entry.source, 'claude')
  assert.ok(entry.id.length > 0)

  const found = store.queryEntries({ text: '中文' })
  assert.equal(found.total, 1)
  assert.equal(found.entries[0].id, entry.id)
  assert.deepEqual(store.listEntries().map((e) => e.id), [entry.id])
  assert.equal(store.usage('user', 'workspace'), 6)
})

test('query 支持 track/scope/text/limit 过滤与截断标记', (t) => {
  const { dir, store } = tempStore()
  t.after(() => closeAndClean({ dir, store }))
  for (let i = 0; i < 5; i += 1) {
    store.insertEntry({ track: 'agent', scope: 'user-global', text: `fact ${i}` })
  }
  store.insertEntry({ track: 'user', scope: 'user-global', text: 'fact other' })
  const capped = store.queryEntries({ track: 'agent', scope: 'user-global', limit: 3 })
  assert.equal(capped.entries.length, 3)
  assert.equal(capped.total, 5)
  assert.equal(capped.truncated, true)
  const byText = store.queryEntries({ text: 'fact 1' })
  assert.equal(byText.total, 1)
  assert.equal(byText.entries[0].text, 'fact 1')
})

test('replace：唯一子串命中即替换，元数据时间推进', (t) => {
  const { dir, store } = tempStore()
  t.after(() => closeAndClean({ dir, store }))
  const first = store.insertEntry({ track: 'user', scope: 'workspace', text: '偏好中文' })
  const { previous, entry } = store.replaceEntry({ track: 'user', scope: 'workspace', match: '偏好', text: '偏好英文', sessionId: 's2' })
  assert.equal(previous.id, first.id)
  assert.equal(entry.id, first.id)
  assert.equal(entry.text, '偏好英文')
  assert.equal(entry.sessionId, 's2')
  assert.equal(store.usage('user', 'workspace'), 4)
})

test('replace/remove：零命中与多命中歧义都响亮报错，条目原样不动', (t) => {
  const { dir, store } = tempStore()
  t.after(() => closeAndClean({ dir, store }))
  store.insertEntry({ track: 'user', scope: 'user-global', text: '偏好中文回复' })
  store.insertEntry({ track: 'user', scope: 'user-global', text: '偏好中文注释' })
  const before = store.listEntries()
  assert.throws(
    () => store.replaceEntry({ track: 'user', scope: 'user-global', match: '不存在', text: 'x' }),
    (error) => error instanceof EntryNotFoundError && error.code === ERROR_CODES.ENTRY_NOT_FOUND,
  )
  assert.throws(
    () => store.removeEntry({ track: 'user', scope: 'user-global', match: '偏好中文' }),
    (error) => error instanceof AmbiguousMatchError && error.details.candidates === 2,
  )
  assert.deepEqual(store.listEntries(), before, '失败后条目必须原样保留（替换超限回滚语义）')
})

test('remove：唯一命中即删除，审计表可重建动作', (t) => {
  const { dir, store } = tempStore()
  t.after(() => closeAndClean({ dir, store }))
  const entry = store.insertEntry({ track: 'agent', scope: 'workspace', text: '临时教训' })
  const removed = store.removeEntry({ track: 'agent', scope: 'workspace', match: '教训' })
  assert.equal(removed.id, entry.id)
  assert.equal(store.queryEntries({}).total, 0)
})

test('非法 track/scope/空文本在 Provider 层响亮拒绝（不落 SQL）', (t) => {
  const { dir, store } = tempStore()
  t.after(() => closeAndClean({ dir, store }))
  assert.throws(() => store.insertEntry({ track: 'nope', scope: 'workspace', text: 'x' }), InvalidInputError)
  assert.throws(() => store.insertEntry({ track: 'user', scope: 'global', text: 'x' }), InvalidInputError)
  assert.throws(() => store.insertEntry({ track: 'user', scope: 'workspace', text: '' }), InvalidInputError)
  assert.throws(() => store.removeEntry({ track: 'user', scope: 'workspace', match: '' }), InvalidInputError)
})

test('audit：动作/结果/来源/会话逐行可查，倒序返回', (t) => {
  const { dir, store } = tempStore()
  t.after(() => closeAndClean({ dir, store }))
  store.auditAppend({ action: 'add', track: 'user', scope: 'workspace', entryId: 'e1', text: 'x', outcome: 'allowed-once (policy auto)', source: 'dsh-memento', sessionId: 's1' })
  store.auditAppend({ action: 'snapshot', track: null, scope: null, entryId: null, text: 'frozen', outcome: 'ok', source: 'dsh-memento', sessionId: 's1' })
  const rows = store.auditList()
  assert.equal(rows.length, 2)
  assert.equal(rows[0].action, 'snapshot')
  assert.equal(rows[1].entryId, 'e1')
  assert.equal(rows[1].outcome, 'allowed-once (policy auto)')
})

test('seedEntries：事务内批量插入，任一条失败整体回滚（无部分写入）', (t) => {
  const { dir, store } = tempStore()
  t.after(() => closeAndClean({ dir, store }))
  assert.throws(
    () => store.seedEntries([
      { track: 'user', scope: 'workspace', text: '第 1 条（应被回滚）' },
      { track: 'invalid-track', scope: 'workspace', text: '第 2 条（非法，触发回滚）' },
    ]),
    InvalidInputError,
  )
  assert.equal(store.queryEntries({}).total, 0, '事务回滚后第 1 条不得残留')
  assert.throws(() => store.seedEntries([]), InvalidInputError)

  const seeded = store.seedEntries([
    { track: 'user', scope: 'user-global', text: 'a', sessionId: 's-batch' },
    { track: 'agent', scope: 'workspace', text: 'b', sessionId: 's-batch' },
  ])
  assert.equal(seeded.length, 2)
  assert.equal(seeded[0].sessionId, 's-batch')
  assert.equal(store.queryEntries({}).total, 2, '合法批次全部落盘')
})

test('queryEntries 显式 limit 被硬钳到 MAX_QUERY_LIMIT（1000）', (t) => {
  const { dir, store } = tempStore()
  t.after(() => closeAndClean({ dir, store }))
  const inputs = Array.from({ length: 1005 }, (_, i) => ({ track: 'agent', scope: 'workspace', text: `fact ${i}` }))
  store.seedEntries(inputs)
  const capped = store.queryEntries({ track: 'agent', scope: 'workspace', limit: 5000 })
  assert.equal(capped.entries.length, 1000)
  assert.equal(capped.total, 1005)
  assert.equal(capped.truncated, true)
})

test('auditRetentionDays：>0 裁剪过期审计行，0 保留全部', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-memento-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const dbPath = path.join(dir, 'memory.db')
  const first = openMemoryStore(dbPath)
  first.db.prepare(`INSERT INTO audit (ts, action, track, scope, entry_id, text, outcome, source, session_id)
    VALUES (?, 'add', null, null, null, 'old', 'ok', 't', null), (?, 'add', null, null, null, 'fresh', 'ok', 't', null)`)
    .run(Date.now() - 10 * 86400000, Date.now())
  first.close()

  const pruned = openMemoryStore(dbPath, { retentionDays: 1 })
  const rows = pruned.auditList()
  assert.equal(rows.length, 1, '仅保留 1 天内的审计行')
  assert.equal(rows[0].text, 'fresh')
  pruned.close()

  const unlimited = openMemoryStore(dbPath)
  assert.equal(unlimited.auditList().length, 1, '默认 0 = 不裁剪')
  unlimited.close()
})

test('consolidateEntries：事务内多子串整合；中途歧义整体回滚（无部分写入）', (t) => {
  const { dir, store } = tempStore()
  t.after(() => closeAndClean({ dir, store }))
  store.insertEntry({ track: 'user', scope: 'workspace', text: '偏好中文回复' })
  store.insertEntry({ track: 'user', scope: 'workspace', text: '偏好中文注释' })
  const { removed, entry } = store.consolidateEntries({
    track: 'user', scope: 'workspace', matches: ['回复', '注释'], text: '偏好中文风格（合并）', sessionId: 's-c',
  })
  assert.equal(removed.length, 2)
  assert.equal(entry.text, '偏好中文风格（合并）')
  assert.equal(entry.sessionId, 's-c')
  assert.equal(store.queryEntries({ track: 'user', scope: 'workspace' }).total, 1)

  store.insertEntry({ track: 'user', scope: 'workspace', text: '偏好中文回复' })
  store.insertEntry({ track: 'user', scope: 'workspace', text: '偏好中文注释' })
  assert.throws(
    () => store.consolidateEntries({ track: 'user', scope: 'workspace', matches: ['回复', '偏好中文'], text: 'x' }),
    (error) => error instanceof AmbiguousMatchError,
  )
  assert.equal(store.queryEntries({ track: 'user', scope: 'workspace' }).total, 3, '回滚：先删除的条目恢复，其余原文不动')
  assert.throws(() => store.consolidateEntries({ track: 'user', scope: 'workspace', matches: [], text: 'x' }), InvalidInputError)
  assert.throws(() => store.consolidateEntries({ track: 'user', scope: 'workspace', matches: ['a'], text: '' }), InvalidInputError)
})

test('库损坏（非 SQLite 文件）在打开点响亮失败', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-memento-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const badPath = path.join(dir, 'memory.db')
  writeFileSync(badPath, 'this is not sqlite', 'utf8')
  assert.throws(
    () => openMemoryStore(badPath),
    (error) => error instanceof StoreError && error.code === ERROR_CODES.STORE_CORRUPT && error.details.path === badPath,
  )
})

test('schema 版本高于本插件 → 响亮拒绝（防降级读坏数据）', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-memento-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const dbPath = path.join(dir, 'memory.db')
  const first = openMemoryStore(dbPath)
  first.db.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(String(SCHEMA_VERSION + 1))
  first.close()
  assert.throws(
    () => openMemoryStore(dbPath),
    (error) => error instanceof StoreError && error.code === ERROR_CODES.STORE_UNSUPPORTED_VERSION,
  )
})

test('v1 库逐级迁移到 v2：条目/审计数据完好，proposals 表就绪', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-memento-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const dbPath = path.join(dir, 'memory.db')
  // 合成 v1 库（历史 schema 快照，纯合成数据；迁移 fixture 模式的第一块样本）。
  const v1 = new DatabaseSync(dbPath)
  v1.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE entries (
      id TEXT PRIMARY KEY,
      track TEXT NOT NULL CHECK (track IN ('user', 'agent')),
      scope TEXT NOT NULL CHECK (scope IN ('user-global', 'workspace')),
      workspace_key TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      session_id TEXT
    );
    CREATE INDEX entries_track_scope ON entries (track, scope);
    CREATE TABLE audit (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      action TEXT NOT NULL,
      track TEXT,
      scope TEXT,
      entry_id TEXT,
      text TEXT,
      outcome TEXT,
      source TEXT,
      session_id TEXT
    );
    CREATE INDEX audit_ts ON audit (ts);
    INSERT INTO meta (key, value) VALUES ('schema_version', '1');
  `)
  v1.prepare(`INSERT INTO entries (id, track, scope, workspace_key, text, source, created_at, updated_at, session_id)
    VALUES ('e-v1', 'user', 'user-global', '', 'v1 遗留条目', 'dsh-memento', 1, 1, 's-v1')`).run()
  v1.prepare(`INSERT INTO audit (ts, action, track, scope, entry_id, text, outcome, source, session_id)
    VALUES (1, 'add', 'user', 'user-global', 'e-v1', 'v1 遗留条目', 'ok', 'dsh-memento', 's-v1')`).run()
  v1.close()

  const store = openMemoryStore(dbPath)
  assert.equal(Number(store.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get().value), 2, '迁移后版本 = 2')
  const entries = store.listEntries()
  assert.equal(entries.length, 1)
  assert.equal(entries[0].text, 'v1 遗留条目', '迁移保留数据')
  assert.equal(store.auditList().length, 1)
  const proposal = store.proposalUpsert({ kind: 'compaction-summary', track: 'agent', scope: 'workspace', text: '迁移后可用', sessionId: 's-v1' })
  assert.ok(proposal, 'proposals 表就绪')
  store.close()
})

test('proposals：幂等 upsert、列表过滤、裁决与非法裁决响亮', (t) => {
  const { dir, store } = tempStore()
  t.after(() => closeAndClean({ dir, store }))
  const p1 = store.proposalUpsert({ kind: 'compaction-summary', track: 'agent', scope: 'workspace', text: '甲', source: 'compaction', sessionId: 's1' })
  assert.ok(p1)
  assert.equal(p1.status, 'pending')
  assert.equal(store.proposalUpsert({ kind: 'compaction-summary', track: 'agent', scope: 'workspace', text: '乙', source: 'compaction', sessionId: 's1' }), null, '同 (session_id, kind) 幂等')
  assert.equal(store.proposalList('pending').length, 1)
  store.proposalDecide(p1.id, 'approved')
  assert.equal(store.proposalList('pending').length, 0)
  assert.equal(store.proposalList('approved').length, 1)
  assert.throws(() => store.proposalDecide(p1.id, 'dismissed'), (error) => error instanceof ProposalNotFoundError)
  assert.throws(() => store.proposalDecide('nope', 'approved'), (error) => error instanceof ProposalNotFoundError)
  assert.throws(() => store.proposalDecide(p1.id, 'maybe'), InvalidInputError)
})

test('resolveDbPath：显式绝对/相对路径与 $DSH_HOME 缺省，缺失 DSH_HOME 响亮失败', () => {
  assert.equal(resolveDbPath('C:\\x\\m.db', 'ignored'), path.normalize('C:\\x\\m.db'))
  assert.equal(resolveDbPath('rel/m.db', '/home/u'), path.resolve('/home/u', 'rel/m.db'))
  assert.equal(resolveDbPath('', '/home/u'), path.join('/home/u', 'dsh-memento', 'memory.db'))
  assert.throws(() => resolveDbPath('', ''), (error) => error instanceof StoreError && error.code === ERROR_CODES.MISSING_DSH_HOME)
})
