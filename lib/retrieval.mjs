// lib/retrieval.mjs — 可插拔检索 Provider seam（零 DSH 依赖）。
//
// 把 memory recall 的"检索"抽成可插拔检索器：默认 substring 匹配器是内置实现
// （零依赖主路径，语义与 lib/match.mjs / store 的 instr 一致）；vector 检索器是
// 可选后端，经探测（embedding provider 可用）才启用，否则优雅降级回 substring。
// sqlite-vec 是可选 loadable 扩展，绝不是本仓库依赖：P0 向量召回用内存内暴力
// 余弦（小语料，与 ARCHITECTURE 决策 10 一致），未来 ANN 索引才需要 sqlite-vec。
//
// 三角色 seam：
// - Service Definition：RetrievalProvider 契约 + RetrievalProviderRegistry。
// - Provider：SubstringRetriever（内置）/ VectorRetriever（可选，消费 embedding）。
// - Consumer：memory_recall 流程（index.mjs 经本 seam 选检索器）。

import { InvalidInputError, RetrievalNotFoundError } from './errors.mjs'
import { cosineSimilarity } from './embedding.mjs'

/**
 * @typedef {object} RetrievalProvider - 检索 Provider 契约（第三方插件实现面）。
 * @property {string} id - 唯一 id（'substring' | 'vector' | 第三方自定义，小写 kebab-case）。
 * @property {string} name - 人类可读名称。
 * @property {string} description - 一句话说明检索方式与适用场景。
 * @property {'substring' | 'vector'} kind - 检索类别（'vector' = 语义检索）。
 * @property {(query: string, entries: Array<{id: string, text: string, recallCount?: number, updatedAt?: number}>) => Array<{id: string, text: string, recallCount?: number, updatedAt?: number}>} retrieve
 *   检索：返回按相关度降序的全部命中（不截断；调用方自行 slice 并算 total/truncated）。
 */

/**
 * 稳定排序比较器：召回频次降序 → 更新时间降序 → id 升序（与 store.queryEntries 排序一致）。
 * @param {{recallCount?: number, updatedAt?: number, id: string}} a - 条目 A。
 * @param {{recallCount?: number, updatedAt?: number, id: string}} b - 条目 B。
 * @returns {number} 比较结果（负数 = A 在前）。
 */
export function rankOrder(a, b) {
  return (b.recallCount ?? 0) - (a.recallCount ?? 0)
    || (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/**
 * 内置 substring 检索器（零依赖主路径）：大小写不敏感子串过滤 + 召回频次排序。
 * 语义与 store 的 instr(lower(text), lower(?)) 一致（ASCII 折叠；CJK 无大小写不受影响）。
 */
export class SubstringRetriever {
  constructor() {
    this.id = 'substring'
    this.name = 'Case-insensitive substring'
    this.description = 'Case-insensitive substring filter ranked by recall frequency (zero-dependency main path)'
    this.kind = /** @type {'substring'} */ ('substring')
  }

  /**
   * @param {string} query - 检索词。
   * @param {Array<{id: string, text: string, recallCount?: number, updatedAt?: number}>} entries - 候选条目。
   * @returns {Array<{id: string, text: string, recallCount?: number, updatedAt?: number}>} 命中条目（相关度排序，不截断）。
   */
  retrieve(query, entries) {
    const lower = String(query).toLowerCase()
    return entries
      .filter((entry) => entry.text.toLowerCase().includes(lower))
      .sort(rankOrder)
  }
}

/**
 * 可选 vector 检索器（消费 embedding provider）：把 query 与候选条目嵌入到同空间，
 * 按余弦相似度降序召回。内存内暴力计算（小语料），不依赖 sqlite-vec / 本地模型。
 */
export class VectorRetriever {
  /**
   * @param {object} opts - 依赖。
   * @param {import('./embedding.mjs').EmbeddingProvider} opts.embedding - 嵌入 provider。
   * @param {string} [opts.id] - 检索器 id（默认 'vector'）。
   * @param {string} [opts.name] - 人类可读名称。
   * @param {string} [opts.description] - 一句话说明。
   */
  constructor(opts) {
    if (opts === null || typeof opts !== 'object' || opts.embedding === undefined || opts.embedding === null) {
      throw new InvalidInputError('VectorRetriever requires an embedding provider')
    }
    this.embedding = opts.embedding
    this.id = opts.id ?? 'vector'
    this.name = opts.name ?? 'Cosine vector'
    this.description = opts.description ?? 'Cosine similarity over an embedding provider (in-memory brute force; no sqlite-vec dependency)'
    this.kind = /** @type {'vector'} */ ('vector')
  }

  /**
   * @param {string} query - 检索词。
   * @param {Array<{id: string, text: string, recallCount?: number, updatedAt?: number}>} entries - 候选条目。
   * @returns {Array<{id: string, text: string, recallCount?: number, updatedAt?: number}>} 全部候选按余弦相似度降序（不截断）。
   */
  retrieve(query, entries) {
    if (entries.length === 0) return []
    const vectors = this.embedding.embed([query, ...entries.map((entry) => entry.text)])
    const queryVector = vectors[0]
    const scored = []
    for (let i = 0; i < entries.length; i += 1) {
      scored.push({ entry: entries[i], score: cosineSimilarity(queryVector, vectors[i + 1]) })
    }
    scored.sort((a, b) => b.score - a.score || rankOrder(a.entry, b.entry))
    return scored.map((scoredEntry) => scoredEntry.entry)
  }
}

/**
 * 探测 vector 后端可用性（优雅降级的判定点）。本仓库不打包 sqlite-vec（零依赖
 * 红线），因此 P0 的向量召回只要求 embedding provider 存在、走内存内暴力余弦；
 * sqliteVec 恒为 false 并留作未来 ANN 索引升级点。
 * @param {object} [opts] - 探测输入。
 * @param {import('./embedding.mjs').EmbeddingProvider | undefined | null} [opts.embedding] - 可用的 embedding provider。
 * @returns {{available: boolean, sqliteVec: boolean, reason?: string}} available=true 才可走 vector 检索。
 */
export function detectVectorBackend(opts = {}) {
  const hasEmbedding = opts.embedding !== undefined && opts.embedding !== null
  return {
    available: hasEmbedding,
    sqliteVec: false,
    ...(hasEmbedding ? {} : { reason: 'no embedding provider available' }),
  }
}

/**
 * 检索 Provider 注册表。协议面：register（可逆）/list/get/resolve。
 * 注册表自身无副作用：生命周期由调用方（index.mjs 的 ctx.effect）管理。
 */
export class RetrievalProviderRegistry {
  constructor() {
    /** @type {Map<string, RetrievalProvider>} */
    this.providers = new Map()
  }

  /**
   * 注册 provider（返回 disposer；同 id 重复注册响亮失败）。
   * @param {RetrievalProvider} provider - provider 定义。
   * @returns {() => void} disposer：调用即注销。
   */
  register(provider) {
    this.#validate(provider)
    if (this.providers.has(provider.id)) {
      throw new InvalidInputError(`retrieval provider ${JSON.stringify(provider.id)} is already registered`)
    }
    this.providers.set(provider.id, provider)
    return () => {
      if (this.providers.get(provider.id) === provider) this.providers.delete(provider.id)
    }
  }

  /**
   * 已注册 provider 的描述列表（按 id 排序，输出稳定）。
   * @returns {Array<{id: string, name: string, description: string, kind: string}>}。
   */
  list() {
    return [...this.providers.values()]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((provider) => ({
        id: provider.id,
        name: provider.name,
        description: provider.description,
        kind: provider.kind,
      }))
  }

  /**
   * 按 id 取 provider（缺省返回 undefined；调用方据此优雅降级）。
   * @param {string} id - provider id。
   * @returns {RetrievalProvider | undefined} provider 或 undefined。
   */
  get(id) {
    return this.providers.get(id)
  }

  /**
   * 按 id 取 provider（缺失响亮失败；显式要求某个 provider 的调用方用此面）。
   * @param {string} id - provider id。
   * @returns {RetrievalProvider} provider。
   */
  resolve(id) {
    const provider = this.providers.get(id)
    if (provider === undefined) throw new RetrievalNotFoundError(id)
    return provider
  }

  /** 契约校验（注册期响亮失败，不把坏 provider 放进表里）。 */
  #validate(/** @type {RetrievalProvider} */ provider) {
    if (provider === null || typeof provider !== 'object') {
      throw new InvalidInputError('retrieval provider must be an object')
    }
    if (typeof provider.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(provider.id)) {
      throw new InvalidInputError('retrieval provider id must be a lowercase kebab-case string')
    }
    if (typeof provider.name !== 'string' || provider.name.length === 0) {
      throw new InvalidInputError('retrieval provider name must be a non-empty string')
    }
    if (typeof provider.description !== 'string' || provider.description.length === 0) {
      throw new InvalidInputError('retrieval provider description must be a non-empty string')
    }
    if (provider.kind !== 'substring' && provider.kind !== 'vector') {
      throw new InvalidInputError("retrieval provider kind must be 'substring' or 'vector'")
    }
    if (typeof provider.retrieve !== 'function') {
      throw new InvalidInputError('retrieval provider must provide a retrieve() function')
    }
  }
}
