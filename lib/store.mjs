// lib/store.mjs — 本地 SQLite Provider（零 DSH 依赖，仅 node: 内置模块）。
//
// 单文件库（WAL），表结构支撑 双轨 × 双层 × 条目文本 + 元数据（来源、创建/更新
// 时间、会话 id）。replace/remove 用唯一子串匹配（instr，绕开 LIKE 转义问题），
// 不唯一/零命中时报错要求更具体。另有插件自有审计表 audit：每条记忆变更/快照
// 落一行（动作、结果、审批来源、会话 id），与审批 seam 的 approval/asked +
// approval/decided 审计对一起构成完整审计链。
//
// Provider 不做预算裁决（那是 Service 层职责），也绝不静默截断。

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, chmodSync, existsSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { SCHEMA_VERSION, DEFAULT_DB_NAME, TRACKS, SCOPES, ERROR_CODES, MAX_QUERY_LIMIT } from './constants.mjs'
import { findUniqueMatch, requireUniqueMatch } from './match.mjs'
import { StoreError, InvalidInputError, EntryNotFoundError, AmbiguousMatchError, ProposalNotFoundError } from './errors.mjs'

/**
 * @typedef {object} EntryRow - entries 表 SELECT 行（toEntry 输入）。
 * @property {string} id
 * @property {'user' | 'agent'} track
 * @property {'user-global' | 'workspace'} scope
 * @property {string} workspace_key
 * @property {string} text
 * @property {string} source
 * @property {number} created_at
 * @property {number} updated_at
 * @property {string | null} session_id
 * @typedef {object} StoreInsertInput
 * @property {string} track
 * @property {string} scope
 * @property {string} [workspaceKey]
 * @property {string} text
 * @property {string} [source]
 * @property {string | null} [sessionId]
 * @typedef {object} StoreMatchInput
 * @property {string} track
 * @property {string} scope
 * @property {string} match
 * @typedef {object} StoreReplaceInput
 * @property {string} track
 * @property {string} scope
 * @property {string} match
 * @property {string} text
 * @property {string | null} [sessionId]
 * @typedef {object} StoreQueryFilter
 * @property {string} [track]
 * @property {string} [scope]
 * @property {string} [text]
 * @property {number} [limit]
 * @typedef {object} AuditInput
 * @property {string} action
 * @property {string | null} [track]
 * @property {string | null} [scope]
 * @property {string | null} [entryId]
 * @property {string | null} [text]
 * @property {string | null} [outcome]
 * @property {string | null} [source]
 * @property {string | null} [sessionId]
 * @typedef {object} AuditRow - audit 表 SELECT 行。
 * @property {number} seq
 * @property {number} ts
 * @property {string} action
 * @property {string | null} track
 * @property {string | null} scope
 * @property {string | null} entry_id
 * @property {string | null} text
 * @property {string | null} outcome
 * @property {string | null} source
 * @property {string | null} session_id
 * @typedef {object} ProposalRow - proposals 表 SELECT 行。
 * @property {string} id
 * @property {string} kind
 * @property {string} track
 * @property {string} scope
 * @property {string} workspace_key
 * @property {string} text
 * @property {string} source
 * @property {string | null} session_id
 * @property {string} status
 * @property {number} created_at
 * @property {number | null} decided_at
 * @typedef {import('node:sqlite').DatabaseSync} Db
 * @typedef {import('../types.js').MemoryEntry} MemoryEntry
 * @typedef {import('../types.js').MemoryQueryResult} MemoryQueryResult
 * @typedef {object} Store - openMemoryStore 返回的 Provider 句柄。
 * @property {Db} db
 * @property {string} path
 * @property {(input: StoreInsertInput) => MemoryEntry} insertEntry
 * @property {(inputs: StoreInsertInput[]) => MemoryEntry[]} seedEntries
 * @property {(input: StoreReplaceInput) => {previous: MemoryEntry, entry: MemoryEntry}} replaceEntry
 * @property {(input: StoreMatchInput) => MemoryEntry} removeEntry
 * @property {(input: {track: string, scope: string, matches: string[], text: string, source?: string, workspaceKey?: string, sessionId?: string | null}) => {removed: MemoryEntry[], entry: MemoryEntry}} consolidateEntries
 * @property {(filter?: StoreQueryFilter) => MemoryQueryResult} queryEntries
 * @property {() => MemoryEntry[]} listEntries
 * @property {(track: string, scope: string) => number} usage
 * @property {(row: AuditInput) => object} auditAppend
 * @property {(limit?: number) => object[]} auditList
 * @property {(input: object) => object | null} proposalUpsert
 * @property {(status?: string, limit?: number) => object[]} proposalList
 * @property {(id: string, status: 'approved' | 'dismissed') => object} proposalDecide
 * @property {() => void} close
 */

/** WAL 之外的 PRAGMA：串行写 + 等待锁上限。 */
const PRAGMAS = 'PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;'

/**
 * POSIX 上把记忆库主文件与已存在的 WAL/-shm 边车收紧为属主读写（0600）。
 * 边车由 SQLite 惰性创建，因此在 PRAGMA WAL 生效之后调用、只 chmod 已存在的
 * 文件（尽力而为，避免为 chmod 触发边车创建）；Windows 无 POSIX 权限位，跳过。
 * @param {string} dbPath - 主库绝对路径。
 * @param {{platform?: string, chmod?: (path: string, mode: number) => void, exists?: (path: string) => boolean}} [io] - 测试注入用。
 */
export function chmodOwned(dbPath, io = {}) {
  const platform = io.platform ?? process.platform
  const chmod = io.chmod ?? chmodSync
  const exists = io.exists ?? existsSync
  if (platform === 'win32') return
  chmod(dbPath, 0o600)
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${dbPath}${suffix}`
    if (exists(sidecar)) chmod(sidecar, 0o600)
  }
}

/**
 * 解析记忆库绝对路径。
 * - 显式绝对路径：原样规范化。
 * - 显式相对路径：相对 $DSH_HOME（有则），否则相对进程 cwd。
 * - 空值：$DSH_HOME/dsh-memento/memory.db；$DSH_HOME 缺失时响亮失败（S5）。
 * @param {string} [dbPath] - Config.dbPath。
 * @param {string|undefined} [dshHome] - 环境 $DSH_HOME（测试注入）。
 * @returns {string} 绝对路径。
 */
export function resolveDbPath(dbPath, dshHome = process.env.DSH_HOME) {
  if (dbPath) {
    const base = dshHome ?? process.cwd()
    return path.isAbsolute(dbPath) ? path.normalize(dbPath) : path.resolve(base, dbPath)
  }
  if (!dshHome) {
    throw new StoreError(
      ERROR_CODES.MISSING_DSH_HOME,
      'dbPath is not configured and $DSH_HOME is not set; run under dsh or set dbPath explicitly',
    )
  }
  return path.join(dshHome, 'dsh-memento', DEFAULT_DB_NAME)
}

/**
 * 校验 track/scope 词汇（写路径入口）。非法值响亮失败，绝不落到 SQL。
 * @param {string} track - 轨道。
 * @param {string} scope - 作用域。
 * @returns {{track: 'user' | 'agent', scope: 'user-global' | 'workspace'}} 原值（已校验）。
 */
export function assertScope(track, scope) {
  if (!/** @type {readonly string[]} */ (TRACKS).includes(track) || !/** @type {readonly string[]} */ (SCOPES).includes(scope)) {
    throw new InvalidInputError(`invalid memory scope: track=${JSON.stringify(track)} scope=${JSON.stringify(scope)} (track ∈ ${TRACKS.join('|')}, scope ∈ ${SCOPES.join('|')})`)
  }
  return { track: /** @type {'user' | 'agent'} */ (track), scope: /** @type {'user-global' | 'workspace'} */ (scope) }
}

/** 把 SELECT 行映射为稳定条目形状。 */
function toEntry(/** @type {EntryRow} */ row) {
  return {
    id: row.id,
    track: row.track,
    scope: row.scope,
    workspaceKey: row.workspace_key,
    text: row.text,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sessionId: row.session_id,
  }
}

/** 把 proposals SELECT 行映射为稳定提案形状。 */
function toProposal(/** @type {ProposalRow} */ row) {
  return {
    id: row.id,
    kind: row.kind,
    track: row.track,
    scope: row.scope,
    workspaceKey: row.workspace_key,
    text: row.text,
    source: row.source,
    sessionId: row.session_id,
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  }
}

/**
 * 打开（或创建）记忆库并迁移到当前 schema。库损坏/版本过新在打开点响亮抛出。
 * @param {string} dbPath - 绝对路径。
 * @param {{retentionDays?: number}} [options] - {retentionDays}：>0 时裁剪超过保留天数的审计行。
 * @returns {Store} store：插入/更新/删除/查询/审计/关闭。
 */
export function openMemoryStore(dbPath, options = {}) {
  mkdirSync(path.dirname(dbPath), { recursive: true })
  let db
  try {
    db = new DatabaseSync(dbPath)
  } catch (error) {
    throw new StoreError(
      ERROR_CODES.STORE_CORRUPT,
      `cannot open memory database at ${dbPath}: ${error instanceof Error ? error.message : String(error)}`,
      { path: dbPath },
    )
  }
  try {
    db.exec(PRAGMAS)
    // S4：边车（-wal/-shm）在 PRAGMA 生效后才被惰性创建，此处统一收紧权限。
    chmodOwned(dbPath)
    migrate(db, dbPath)
    pruneAudit(db, options.retentionDays ?? 0)
  } catch (error) {
    closeDb(db)
    if (error instanceof StoreError) throw error
    throw new StoreError(
      ERROR_CODES.STORE_CORRUPT,
      `memory database at ${dbPath} failed schema validation: ${error instanceof Error ? error.message : String(error)}`,
      { path: dbPath },
    )
  }

  const store = {
    db,
    path: dbPath,

    /**
     * 新增一条记忆。
     * @param {StoreInsertInput} input - {track, scope, workspaceKey, text, source, sessionId}。
     * @returns {MemoryEntry} 已落盘条目。
     */
    insertEntry(input) {
      return insertOne(db, input)
    },

    /**
     * 批量插入（事务内原子：任一条失败整体回滚，绝无部分写入）。
     * @param {StoreInsertInput[]} inputs - 与 insertEntry 相同的输入数组。
     * @returns {MemoryEntry[]} 已落盘条目（与输入同序）。
     */
    seedEntries(inputs) {
      if (!Array.isArray(inputs) || inputs.length === 0) {
        throw new InvalidInputError('seed requires a non-empty entry list')
      }
      return withTransaction(db, () => inputs.map((input) => insertOne(db, input)))
    },

    /**
     * 按唯一子串匹配并替换文本（事务内匹配+更新，原子）。
     * @param {StoreReplaceInput} input - {track, scope, match, text, sessionId}。
     * @returns {{previous: MemoryEntry, entry: MemoryEntry}} 旧条目与更新后的条目。
     */
    replaceEntry(input) {
      const { track, scope } = assertScope(input.track, input.scope)
      if (typeof input.match !== 'string' || input.match.length === 0) {
        throw new InvalidInputError('replace/remove match must be a non-empty string')
      }
      if (typeof input.text !== 'string' || input.text.length === 0) {
        throw new InvalidInputError('entry text must be a non-empty string')
      }
      return withTransaction(db, () => {
        const found = matchEntries(db, track, scope, input.match)
        const target = requireUniqueMatch(findUniqueMatch(found, input.match), { track, scope, match: input.match }, { EntryNotFoundError, AmbiguousMatchError })
        db.prepare('UPDATE entries SET text = ?, updated_at = ?, session_id = ? WHERE id = ?')
          .run(input.text, Date.now(), input.sessionId ?? null, target.id)
        return { previous: target, entry: getEntry(db, target.id) }
      })
    },

    /**
     * 按唯一子串匹配并删除（事务内匹配+删除，原子）。
     * @param {StoreMatchInput} input - {track, scope, match}。
     * @returns {MemoryEntry} 被删除的条目。
     */
    removeEntry(input) {
      const { track, scope } = assertScope(input.track, input.scope)
      if (typeof input.match !== 'string' || input.match.length === 0) {
        throw new InvalidInputError('replace/remove match must be a non-empty string')
      }
      return withTransaction(db, () => {
        const found = matchEntries(db, track, scope, input.match)
        const target = requireUniqueMatch(findUniqueMatch(found, input.match), { track, scope, match: input.match }, { EntryNotFoundError, AmbiguousMatchError })
        db.prepare('DELETE FROM entries WHERE id = ?').run(target.id)
        return target
      })
    },

    /**
     * 事务内按多个唯一子串整合：逐一定位（零/多命中响亮报错）→ 全部删除 → 插入新条目。
     * 任一步失败整体回滚（原子，绝无部分写入）。
     * @param {{track: string, scope: string, matches: string[], text: string, source?: string, workspaceKey?: string, sessionId?: string | null}} input - 整合方案。
     * @returns {{removed: MemoryEntry[], entry: MemoryEntry}} 被删除的旧条目与新条目。
     */
    consolidateEntries(input) {
      const { track, scope } = assertScope(input.track, input.scope)
      if (!Array.isArray(input.matches) || input.matches.length === 0 || input.matches.length > 20) {
        throw new InvalidInputError('consolidate matches must be an array of 1..20 non-empty strings')
      }
      if (typeof input.text !== 'string' || input.text.length === 0) {
        throw new InvalidInputError('entry text must be a non-empty string')
      }
      for (const match of input.matches) {
        if (typeof match !== 'string' || match.length === 0) {
          throw new InvalidInputError('consolidate matches must be an array of 1..20 non-empty strings')
        }
      }
      return withTransaction(db, () => {
        const removed = []
        for (const match of input.matches) {
          const found = matchEntries(db, track, scope, match)
          const target = requireUniqueMatch(findUniqueMatch(found, match), { track, scope, match }, { EntryNotFoundError, AmbiguousMatchError })
          db.prepare('DELETE FROM entries WHERE id = ?').run(target.id)
          removed.push(target)
        }
        const entry = insertOne(db, {
          track, scope, text: input.text,
          workspaceKey: input.workspaceKey,
          source: input.source,
          sessionId: input.sessionId ?? null,
        })
        return { removed, entry }
      })
    },

    /**
     * 查询条目：子串过滤（大小写敏感）+ 数量上限。
     * @param {StoreQueryFilter} [filter] - {track, scope, text, limit}。
     * @returns {MemoryQueryResult}。
     */
    queryEntries(filter = {}) {
      const conditions = []
      const params = []
      if (filter.track !== undefined) { conditions.push('track = ?'); params.push(filter.track) }
      if (filter.scope !== undefined) { conditions.push('scope = ?'); params.push(filter.scope) }
      if (typeof filter.text === 'string' && filter.text.length > 0) {
        conditions.push('instr(text, ?) > 0'); params.push(filter.text)
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      const total = /** @type {number} */ (db.prepare(`SELECT COUNT(*) AS n FROM entries ${where}`).get(...params).n)
      const requested = Number.isInteger(filter.limit) && filter.limit > 0 ? filter.limit : MAX_QUERY_LIMIT
      const limit = Math.min(requested, MAX_QUERY_LIMIT)
      const rows = /** @type {EntryRow[]} */ (db.prepare(`SELECT * FROM entries ${where} ORDER BY created_at, id LIMIT ?`)
        .all(...params, limit))
      return { entries: rows.map(toEntry), total, truncated: total > rows.length }
    },

    /** @returns {MemoryEntry[]} 全部条目（快照/报表用）。 */
    listEntries() {
      return /** @type {EntryRow[]} */ (db.prepare('SELECT * FROM entries ORDER BY created_at, id').all()).map(toEntry)
    },

    /**
     * (track, scope) 当前字符用量（JS 字符数，与 lib/budget.mjs 一致）。
     * @param {string} track - 轨道。
     * @param {string} scope - 作用域。
     * @returns {number} 用量。
     */
    usage(track, scope) {
      let used = 0
      const rows = /** @type {Array<{text: string}>} */ (db.prepare('SELECT text FROM entries WHERE track = ? AND scope = ?').all(track, scope))
      for (const row of rows) {
        used += row.text.length
      }
      return used
    },

    /**
     * 追加一条审计记录（插件自有审计账本，独立于会话日志）。
     * @param {AuditInput} row - {action, track, scope, entryId, text, outcome, source, sessionId}。
     * @returns {object} 审计行（含 seq 与 ts）。
     */
    auditAppend(row) {
      const ts = Date.now()
      db.prepare(`INSERT INTO audit (ts, action, track, scope, entry_id, text, outcome, source, session_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(ts, row.action, row.track ?? null, row.scope ?? null, row.entryId ?? null,
          row.text ?? null, row.outcome ?? null, row.source ?? null, row.sessionId ?? null)
      return { seq: Number(db.prepare('SELECT last_insert_rowid() AS seq').get().seq), ts, ...row }
    },

    /**
     * 最近审计行（面板/审计用）。
     * @param {number} [limit] - 上限。
     * @returns {object[]} 按时间倒序。
     */
    auditList(limit = 100) {
      return /** @type {AuditRow[]} */ (db.prepare('SELECT * FROM audit ORDER BY seq DESC LIMIT ?').all(limit))
        .map((row) => ({
          seq: row.seq,
          ts: row.ts,
          action: row.action,
          track: row.track,
          scope: row.scope,
          entryId: row.entry_id,
          text: row.text,
          outcome: row.outcome,
          source: row.source,
          sessionId: row.session_id,
        }))
    },

    /** 关闭连接（幂等）。 */
    close() {
      closeDb(db)
    },

    /**
     * 幂等插入提案：同 (session_id, kind) 已存在则跳过并返回 null（INSERT OR IGNORE）。
     * @param {{kind: string, track: string, scope: string, workspaceKey?: string, text: string, source?: string, sessionId?: string | null}} input - 提案内容。
     * @returns {object | null} 已落盘提案；幂等命中返回 null。
     */
    proposalUpsert(input) {
      const { track, scope } = assertScope(input.track, input.scope)
      if (typeof input.text !== 'string' || input.text.length === 0) {
        throw new InvalidInputError('proposal text must be a non-empty string')
      }
      const id = randomUUID()
      const ts = Date.now()
      const result = db.prepare(`INSERT OR IGNORE INTO proposals
        (id, kind, track, scope, workspace_key, text, source, session_id, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
        .run(id, input.kind, track, scope, input.workspaceKey ?? '', input.text,
          input.source ?? 'dsh-memento', input.sessionId ?? null, ts)
      if (result.changes === 0) return null
      return toProposal(/** @type {ProposalRow} */ (db.prepare('SELECT * FROM proposals WHERE id = ?').get(id)))
    },

    /**
     * 提案列表（按创建时间升序；可按状态过滤）。
     * @param {string} [status] - pending/approved/dismissed；省略返回全部。
     * @param {number} [limit] - 上限（默认 100）。
     * @returns {object[]} 提案数组。
     */
    proposalList(status, limit = 100) {
      const where = status === undefined ? '' : 'WHERE status = ?'
      const params = status === undefined ? [limit] : [status, limit]
      const rows = /** @type {ProposalRow[]} */ (db.prepare(`SELECT * FROM proposals ${where} ORDER BY created_at, id LIMIT ?`).all(...params))
      return rows.map(toProposal)
    },

    /**
     * 裁决提案：pending → approved/dismissed（幂等约束：非 pending 响亮报错）。
     * @param {string} id - 提案 id。
     * @param {'approved' | 'dismissed'} status - 目标状态。
     * @returns {object} 已裁决提案。
     */
    proposalDecide(id, status) {
      if (status !== 'approved' && status !== 'dismissed') {
        throw new InvalidInputError(`proposal decision must be approved or dismissed, got ${JSON.stringify(status)}`)
      }
      const row = /** @type {ProposalRow | undefined} */ (db.prepare('SELECT * FROM proposals WHERE id = ?').get(id))
      if (row === undefined) throw new ProposalNotFoundError(id)
      if (row.status !== 'pending') throw new ProposalNotFoundError(id, `already ${row.status}`)
      db.prepare('UPDATE proposals SET status = ?, decided_at = ? WHERE id = ?').run(status, Date.now(), id)
      return toProposal(/** @type {ProposalRow} */ (db.prepare('SELECT * FROM proposals WHERE id = ?').get(id)))
    },
  }
  return store
}

/** 按 id 读取单条。 */
function getEntry(/** @type {Db} */ db, /** @type {string} */ id) {
  const row = /** @type {EntryRow | undefined} */ (db.prepare('SELECT * FROM entries WHERE id = ?').get(id))
  if (row === undefined) throw new StoreError(ERROR_CODES.STORE_CORRUPT, `entry ${id} vanished mid-transaction`)
  return toEntry(row)
}

/** 校验并插入单条（insertEntry 与 seedEntries 共用；调用方决定是否在事务内）。 */
function insertOne(/** @type {Db} */ db, /** @type {StoreInsertInput} */ input) {
  const { track, scope } = assertScope(input.track, input.scope)
  if (typeof input.text !== 'string' || input.text.length === 0) {
    throw new InvalidInputError('entry text must be a non-empty string')
  }
  const entry = {
    id: randomUUID(),
    track,
    scope,
    workspaceKey: input.workspaceKey ?? '',
    text: input.text,
    source: input.source ?? 'dsh-memento',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sessionId: input.sessionId ?? null,
  }
  db.prepare(`INSERT INTO entries (id, track, scope, workspace_key, text, source, created_at, updated_at, session_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(entry.id, entry.track, entry.scope, entry.workspaceKey, entry.text, entry.source,
      entry.createdAt, entry.updatedAt, entry.sessionId)
  return entry
}

/** 子串匹配候选（instr，大小写敏感）。 */
function matchEntries(/** @type {Db} */ db, /** @type {string} */ track, /** @type {string} */ scope, /** @type {string} */ match) {
  return /** @type {EntryRow[]} */ (db.prepare(`SELECT * FROM entries WHERE track = ? AND scope = ? AND instr(text, ?) > 0 ORDER BY created_at, id`)
    .all(track, scope, match))
    .map(toEntry)
}

/** 事务包装：失败回滚并原样重抛（空 catch 语义：只回滚，不回吞）。 */
function withTransaction(/** @type {Db} */ db, /** @type {() => any} */ fn) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* 连接已坏时 ROLLBACK 无意义，保留原错误 */ }
    throw error
  }
}

/** 建表 + 版本迁移。新库直接建当前版本；旧库逐级迁移；版本高于当前 → 响亮拒绝（防降级读坏数据）。 */
function migrate(/** @type {Db} */ db, /** @type {string} */ dbPath) {
  // 新库先探测表存在性再 prepare：对不存在的表 prepare 会直接抛错。
  const hasMeta = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get() !== undefined
  if (!hasMeta) {
    db.exec(BASE_SCHEMA_SQL)
    db.exec(PROPOSALS_SCHEMA_SQL)
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION))
    return
  }
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version')
  const version = row === undefined ? 0 : Number(row.value)
  if (!Number.isInteger(version) || version < 0) {
    throw new StoreError(ERROR_CODES.STORE_CORRUPT, `memory database at ${dbPath} has invalid schema_version ${JSON.stringify(row?.value)}`, { path: dbPath })
  }
  if (version > SCHEMA_VERSION) {
    throw new StoreError(
      ERROR_CODES.STORE_UNSUPPORTED_VERSION,
      `memory database at ${dbPath} has schema_version ${version} > supported ${SCHEMA_VERSION}; upgrade dsh-memento instead of downgrading`,
      { path: dbPath },
    )
  }
  if (version < 2) {
    db.exec(PROPOSALS_SCHEMA_SQL)
    db.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(String(2))
  }
}

/** v1 基础表（meta/entries/audit）——新库与逐级迁移共用。 */
const BASE_SCHEMA_SQL = `
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
`

/** v2 proposals 提案表（auto-capture 的压缩记忆提案；(session_id, kind) 幂等）。 */
const PROPOSALS_SCHEMA_SQL = `
  CREATE TABLE proposals (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    track TEXT NOT NULL,
    scope TEXT NOT NULL,
    workspace_key TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL,
    source TEXT NOT NULL,
    session_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'dismissed')),
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    UNIQUE (session_id, kind)
  );
  CREATE INDEX proposals_status ON proposals (status);
`

/** 关闭连接（幂等，吞掉二次关闭的报错）。 */
function closeDb(/** @type {Db} */ db) {
  try { db.close() } catch { /* 已关闭或关闭失败：disposer 里不抛出，避免遮蔽卸载主错误 */ }
}

/** 审计保留裁剪：retentionDays > 0 时删除早于截止时间的审计行（audit_ts 索引已存在）。 */
function pruneAudit(/** @type {Db} */ db, /** @type {number} */ retentionDays) {
  if (!Number.isInteger(retentionDays) || retentionDays <= 0) return
  const cutoff = Date.now() - retentionDays * 86400000
  db.prepare('DELETE FROM audit WHERE ts < ?').run(cutoff)
}
