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
import { SCHEMA_VERSION, DEFAULT_DB_NAME, TRACKS, SCOPES, ERROR_CODES } from './constants.mjs'
import { findUniqueMatch, requireUniqueMatch } from './match.mjs'
import { StoreError, InvalidInputError, EntryNotFoundError, AmbiguousMatchError } from './errors.mjs'

/** WAL 之外的 PRAGMA：串行写 + 等待锁上限。 */
const PRAGMAS = 'PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;'

/**
 * POSIX 上把记忆库主文件与已存在的 WAL/-shm 边车收紧为属主读写（0600）。
 * 边车由 SQLite 惰性创建，因此在 PRAGMA WAL 生效之后调用、只 chmod 已存在的
 * 文件（尽力而为，避免为 chmod 触发边车创建）；Windows 无 POSIX 权限位，跳过。
 * @param {string} dbPath - 主库绝对路径。
 * @param {object} [io] - {platform, chmod, exists}，测试注入用。
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
 * @returns {{track: string, scope: string}} 原值（已校验）。
 */
export function assertScope(track, scope) {
  if (!TRACKS.includes(track) || !SCOPES.includes(scope)) {
    throw new InvalidInputError(`invalid memory scope: track=${JSON.stringify(track)} scope=${JSON.stringify(scope)} (track ∈ ${TRACKS.join('|')}, scope ∈ ${SCOPES.join('|')})`)
  }
  return { track, scope }
}

/** 把 SELECT 行映射为稳定条目形状。 */
function toEntry(row) {
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

/**
 * 打开（或创建）记忆库并迁移到当前 schema。库损坏/版本过新在打开点响亮抛出。
 * @param {string} dbPath - 绝对路径。
 * @returns {object} store：插入/更新/删除/查询/审计/关闭。
 */
export function openMemoryStore(dbPath) {
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
     * @param {object} input - {track, scope, workspaceKey, text, source, sessionId}。
     * @returns {object} 已落盘条目。
     */
    insertEntry(input) {
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
    },

    /**
     * 按唯一子串匹配并替换文本（事务内匹配+更新，原子）。
     * @param {object} input - {track, scope, match, text, sessionId}。
     * @returns {{previous: object, entry: object}} 旧条目与更新后的条目。
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
     * @param {object} input - {track, scope, match}。
     * @returns {object} 被删除的条目。
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
     * 查询条目：子串过滤（大小写敏感）+ 数量上限。
     * @param {object} [filter] - {track, scope, text, limit}。
     * @returns {{entries: object[], total: number, truncated: boolean}}。
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
      const total = db.prepare(`SELECT COUNT(*) AS n FROM entries ${where}`).get(...params).n
      const limit = Number.isInteger(filter.limit) && filter.limit > 0 ? filter.limit : 1000
      const rows = db.prepare(`SELECT * FROM entries ${where} ORDER BY created_at, id LIMIT ?`)
        .all(...params, limit)
      return { entries: rows.map(toEntry), total, truncated: total > rows.length }
    },

    /** @returns {object[]} 全部条目（快照/报表用）。 */
    listEntries() {
      return db.prepare('SELECT * FROM entries ORDER BY created_at, id').all().map(toEntry)
    },

    /**
     * (track, scope) 当前字符用量（JS 字符数，与 lib/budget.mjs 一致）。
     * @param {string} track - 轨道。
     * @param {string} scope - 作用域。
     * @returns {number} 用量。
     */
    usage(track, scope) {
      let used = 0
      for (const row of db.prepare('SELECT text FROM entries WHERE track = ? AND scope = ?').all(track, scope)) {
        used += row.text.length
      }
      return used
    },

    /**
     * 追加一条审计记录（插件自有审计账本，独立于会话日志）。
     * @param {object} row - {action, track, scope, entryId, text, outcome, source, sessionId}。
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
      return db.prepare('SELECT * FROM audit ORDER BY seq DESC LIMIT ?').all(limit)
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
  }
  return store
}

/** 按 id 读取单条。 */
function getEntry(db, id) {
  const row = db.prepare('SELECT * FROM entries WHERE id = ?').get(id)
  if (row === undefined) throw new StoreError(ERROR_CODES.STORE_CORRUPT, `entry ${id} vanished mid-transaction`)
  return toEntry(row)
}

/** 子串匹配候选（instr，大小写敏感）。 */
function matchEntries(db, track, scope, match) {
  return db.prepare(`SELECT * FROM entries WHERE track = ? AND scope = ? AND instr(text, ?) > 0 ORDER BY created_at, id`)
    .all(track, scope, match)
    .map(toEntry)
}

/** 事务包装：失败回滚并原样重抛（空 catch 语义：只回滚，不回吞）。 */
function withTransaction(db, fn) {
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

/** 建表 + 版本迁移。版本高于当前 → 响亮拒绝（防降级读坏数据）。 */
function migrate(db, dbPath) {
  // 新库先探测表存在性再 prepare：对不存在的表 prepare 会直接抛错。
  const hasMeta = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get() !== undefined
  if (!hasMeta) {
    db.exec(`
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
      INSERT INTO meta (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}');
    `)
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
}

/** 关闭连接（幂等，吞掉二次关闭的报错）。 */
function closeDb(db) {
  try { db.close() } catch { /* 已关闭或关闭失败：disposer 里不抛出，避免遮蔽卸载主错误 */ }
}
