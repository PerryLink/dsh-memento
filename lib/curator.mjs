// lib/curator.mjs — 零 DSH 依赖的记忆整理分析器（只读）。
//
// 识别四类可整理信号，产出一个**可审阅的整理计划**（plan.actions）：
//   1) merge-duplicates：同一层（track/scope/agentKey）内文本（近）重复的条目簇；
//   2) supersede：同一簇内文本不同、疑似冲突，保留价值最高（召回次数/更新时间/
//      长度）者为正文，其余并入；
//   3) decay：recallCount 为 0 且距上次召回/更新超过 decayDays 天的陈旧条目；
//   4) budget：某层字符用量已达预算 budgetRatio 比例的预算压力整理建议。
//
// 本模块**只做分析，绝不改写存储**。真正落盘须由调用方经 /memory consolidate 或
// /memory remove（走审批门）执行——尊重「写满必须报错、绝不静默截断、绝不自动压缩」
// 的预算不变量（见 lib/budget.mjs）。applyable=false 的动作（如文本完全相同的重复
// 条目无法用唯一子串定位）需人工介入。

/**
 * @typedef {Object} CurationEntry
 * @property {string} id
 * @property {string} track
 * @property {string} scope
 * @property {string} [agentKey]
 * @property {string} text
 * @property {number} recallCount
 * @property {number} updatedAt
 * @property {number | null} lastRecalled
 */

const DEFAULT_OPTIONS = Object.freeze({
  similarityThreshold: 0.85,
  decayDays: 90,
  budgetRatio: 0.9,
  maxActions: 50,
})

/**
 * NFKC 归一化 + 小写 + 折叠空白：用于相似度与去重判定的稳定键。
 * @param {unknown} input - 任意文本。
 * @returns {string} 归一化文本。
 */
export function normalizeText(input) {
  return String(input).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * 字符 bigram 集合（对 CJK 与拉丁都稳健，无需分词）。
 * @param {string} text - 归一化文本。
 * @returns {Set<string>} bigram 集合。
 */
function bigrams(text) {
  const set = new Set()
  for (let i = 0; i < text.length - 1; i += 1) set.add(text.slice(i, i + 2))
  return set
}

/**
 * 两段文本的相似度：归一化相等即 1，否则取字符 bigram Jaccard。
 * @param {string} a - 文本 A。
 * @param {string} b - 文本 B。
 * @returns {number} 0..1。
 */
export function similarity(a, b) {
  const na = normalizeText(a)
  const nb = normalizeText(b)
  if (na === nb) return 1
  const ba = bigrams(na)
  const bb = bigrams(nb)
  if (ba.size === 0 || bb.size === 0) return 0
  let inter = 0
  for (const gram of ba) if (bb.has(gram)) inter += 1
  const union = ba.size + bb.size - inter
  return union === 0 ? 1 : inter / union
}

/**
 * @param {CurationEntry} entry - 条目。
 * @returns {string} 分组键（含 agentKey）。
 */
function groupKey(entry) {
  return `${entry.track}\u0000${entry.scope}\u0000${entry.agentKey ?? ''}`
}

/**
 * @param {CurationEntry} entry - 条目。
 * @returns {string} 层键（track+scope，不含 agentKey）。
 */
function layerKey(entry) {
  return `${entry.track}\u0000${entry.scope}`
}

/**
 * 价值高者靠前：recallCount desc → updatedAt desc → 文本长度 desc → id asc。
 * @param {CurationEntry} a - 条目 A。
 * @param {CurationEntry} b - 条目 B。
 * @returns {number} 排序值。
 */
function valueOrder(a, b) {
  return b.recallCount - a.recallCount
    || b.updatedAt - a.updatedAt
    || b.text.length - a.text.length
    || String(a.id).localeCompare(String(b.id))
}

/**
 * @param {number} size - 元素个数。
 * @returns {{find: (x: number) => number, union: (a: number, b: number) => void}} 并查集。
 */
function makeUnionFind(size) {
  const parent = Array.from({ length: size }, (_, i) => i)
  /** @param {number} x @returns {number} */
  const find = (x) => {
    let root = x
    while (parent[root] !== root) root = parent[root]
    while (parent[x] !== root) {
      const next = parent[x]
      parent[x] = root
      x = next
    }
    return root
  }
  /** @param {number} a @param {number} b */
  const union = (a, b) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }
  return { find, union }
}

/**
 * 分析条目集合，产出整理计划（纯函数，不改库）。
 * @param {CurationEntry[]} entries - 全部条目。
 * @param {{similarityThreshold?: number, decayDays?: number, budgetRatio?: number, maxActions?: number, now?: number, limits?: Record<string, Record<string, number>>}} [options] - 选项；limits 形如 {user:{'user-global':2000, workspace:2000}, agent:{...}}。
 * @returns {{generatedAt: number, options: object, actions: object[], counts: {mergeDuplicates: number, supersede: number, decay: number, budget: number, manual: number}}} 整理计划。
 */
export function analyzeCuration(entries, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const now = opts.now ?? Date.now()
  const decayMs = opts.decayDays * 86400000
  /** @type {object[]} */
  const actions = []

  // 每层内（忽略 agentKey）同一归一化文本出现次数：唯一才能用子串定位落盘。
  /** @type {Map<string, number>} */
  const textCount = new Map()
  for (const entry of entries) {
    const key = `${layerKey(entry)}\u0000${normalizeText(entry.text)}`
    textCount.set(key, (textCount.get(key) ?? 0) + 1)
  }
  /** @type {(entry: CurationEntry) => boolean} */
  const uniqueInLayer = (entry) => (textCount.get(`${layerKey(entry)}\u0000${normalizeText(entry.text)}`) ?? 0) === 1

  // 1) 重复 / 冲突簇
  /** @type {Map<string, CurationEntry[]>} */
  const groups = new Map()
  for (const entry of entries) {
    const key = groupKey(entry)
    if (!groups.has(key)) groups.set(key, [])
    const bucket = groups.get(key)
    if (bucket !== undefined) bucket.push(entry)
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue
    const uf = makeUnionFind(list.length)
    const grams = list.map((entry) => bigrams(normalizeText(entry.text)))
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const na = normalizeText(list[i].text)
        const nb = normalizeText(list[j].text)
        let sim
        if (na === nb) sim = 1
        else if (grams[i].size === 0 || grams[j].size === 0) sim = 0
        else {
          let inter = 0
          for (const gram of grams[i]) if (grams[j].has(gram)) inter += 1
          const union = grams[i].size + grams[j].size - inter
          sim = union === 0 ? 1 : inter / union
        }
        if (sim >= opts.similarityThreshold) uf.union(i, j)
      }
    }
    /** @type {Map<number, CurationEntry[]>} */
    const clusters = new Map()
    for (let i = 0; i < list.length; i += 1) {
      const root = uf.find(i)
      if (!clusters.has(root)) clusters.set(root, [])
      const bucket = clusters.get(root)
      if (bucket !== undefined) bucket.push(list[i])
    }
    for (const cluster of clusters.values()) {
      if (cluster.length < 2) continue
      const sorted = [...cluster].sort(valueOrder)
      const canonical = sorted[0]
      const normalized = cluster.map((entry) => normalizeText(entry.text))
      const exactDuplicate = new Set(normalized).size < cluster.length
      const conflict = normalized.some((text) => text !== normalizeText(canonical.text))
      actions.push({
        type: conflict ? 'supersede' : 'merge-duplicates',
        track: canonical.track,
        scope: canonical.scope,
        ...(canonical.agentKey === undefined ? {} : { agentKey: canonical.agentKey }),
        keep: canonical.text,
        matches: Array.from(new Set(cluster.map((entry) => entry.text))),
        removedCount: cluster.length - 1,
        conflict,
        exactDuplicate,
        applyable: !exactDuplicate && cluster.every((entry) => uniqueInLayer(entry)),
      })
    }
  }

  // 2) 时间衰减
  for (const entry of entries) {
    const last = entry.lastRecalled ?? entry.updatedAt
    if (entry.recallCount === 0 && now - last > decayMs) {
      actions.push({
        type: 'decay',
        track: entry.track,
        scope: entry.scope,
        ...(entry.agentKey === undefined ? {} : { agentKey: entry.agentKey }),
        match: entry.text,
        staleDays: Math.floor((now - last) / 86400000),
        applyable: uniqueInLayer(entry),
      })
    }
  }

  // 3) 预算压力
  const limits = opts.limits ?? {}
  /** @type {Map<string, number>} */
  const layerChars = new Map()
  for (const entry of entries) {
    const key = layerKey(entry)
    layerChars.set(key, (layerChars.get(key) ?? 0) + entry.text.length)
  }
  for (const [key, used] of layerChars) {
    const [track, scope] = key.split('\u0000')
    const limit = limits?.[track]?.[scope]
    if (!Number.isFinite(limit) || limit <= 0) continue
    if (used < limit * opts.budgetRatio) continue
    const layer = entries.filter((entry) => layerKey(entry) === key)
    const lowest = [...layer].sort((a, b) => valueOrder(b, a))
    let projected = used
    /** @type {Array<{match: string, applyable: boolean}>} */
    const picks = []
    for (const entry of lowest) {
      if (projected < limit * opts.budgetRatio) break
      picks.push({ match: entry.text, applyable: uniqueInLayer(entry) })
      projected -= entry.text.length
    }
    if (picks.length > 0) {
      actions.push({ type: 'budget', track, scope, used, limit, ratio: opts.budgetRatio, picks, applyable: picks.some((pick) => pick.applyable) })
    }
  }

  const counts = { mergeDuplicates: 0, supersede: 0, decay: 0, budget: 0, manual: 0 }
  for (const action of actions) {
    const kind = /** @type {{type?: string, applyable?: boolean}} */ (action).type
    if (kind === 'merge-duplicates') counts.mergeDuplicates += 1
    else if (kind === 'supersede') counts.supersede += 1
    else if (kind === 'decay') counts.decay += 1
    else if (kind === 'budget') counts.budget += 1
    if (/** @type {{applyable?: boolean}} */ (action).applyable === false) counts.manual += 1
  }
  return { generatedAt: now, options: opts, actions: actions.slice(0, opts.maxActions), counts }
}
