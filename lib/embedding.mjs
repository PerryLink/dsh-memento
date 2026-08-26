// lib/embedding.mjs — embedding Provider seam（零 DSH 依赖，仅 node: 内置模块）。
//
// 三角色 seam：
// - Service Definition：EmbeddingProvider 契约 + EmbeddingProviderRegistry
//   （register 可逆 / list / get / resolve；id 冲突响亮失败，未知 id 响亮失败）。
// - Provider：FakeEmbeddingProvider——确定性的 token/字符哈希伪嵌入（token 哈希分桶
//   计数 + L2 归一化）。它不做语义建模，仅验证 seam 接线与余弦召回路径可复现；真实
//   嵌入由探测到的本地模型 / 可选 peer 提供，本仓库不引入任何重依赖
//   （sqlite-vec / ONNX / 本地模型都不是真实依赖）。
// - Consumer：lib/retrieval.mjs 的 VectorRetriever + memory_recall 流程。
//
// 伪嵌入是确定性的：同一文本永远产出同一向量（测试/演示可复现）；同一 token 集
// 产出的向量余弦相似度为 1，token 重叠度越高余弦越大（接口级召回语义）。

import { InvalidInputError, EmbeddingNotFoundError } from './errors.mjs'

/** 伪嵌入默认维度（协议常量，非部署 tunable；真实 provider 以自身维度为准）。 */
export const DEFAULT_EMBEDDING_DIMENSIONS = 256

/**
 * @typedef {object} EmbeddingProvider - 嵌入 Provider 契约（第三方插件实现面）。
 * @property {string} id - 唯一 provider id（小写 kebab-case）。
 * @property {string} name - 人类可读名称。
 * @property {string} description - 一句话说明嵌入来源与适用场景。
 * @property {number} dimensions - 固定向量维度（正整数）。
 * @property {(texts: string[]) => number[][]} embed - 文本数组 → 等长向量数组（每向量长 dimensions）。
 */

/**
 * 把文本确定性哈希为固定维度单位向量（token 哈希分桶计数 → L2 归一化，即"哈希化
 * token 袋"）。同一 token 集产出的向量余弦相似度为 1，token 重叠越多余弦越大——
 * 是接口级召回语义，不做真实语义建模。空文本（无字母/数字 token）得到全零向量。
 * @param {string} text - 待嵌入文本。
 * @param {number} [dimensions] - 向量维度（默认 256）。
 * @returns {number[]} 单位向量（非空文本）或全零向量（空文本）。
 */
export function hashEmbed(text, dimensions = DEFAULT_EMBEDDING_DIMENSIONS) {
  const lower = String(text).toLowerCase()
  const vector = new Array(dimensions).fill(0)
  const tokens = lower.match(/[\p{L}\p{N}]+/gu)
  if (tokens === null || tokens.length === 0) return vector
  for (const token of tokens) {
    let hash = 2166136261
    for (let i = 0; i < token.length; i += 1) {
      hash ^= token.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    vector[(hash >>> 0) % dimensions] += 1
  }
  return l2Normalize(vector)
}

/**
 * L2 归一化（零向量原样返回，避免除零）。
 * @param {number[]} vector - 输入向量。
 * @returns {number[]} 单位向量（或全零向量）。
 */
export function l2Normalize(vector) {
  let norm = 0
  for (let i = 0; i < vector.length; i += 1) norm += vector[i] * vector[i]
  norm = Math.sqrt(norm)
  if (norm === 0) return vector.slice()
  return vector.map((value) => value / norm)
}

/**
 * 余弦相似度 = 两单位向量的点积（输入应为归一化向量，如 hashEmbed 产物）。
 * 任一输入为零向量时返回 0。
 * @param {number[]} a - 单位向量 A。
 * @param {number[]} b - 单位向量 B。
 * @returns {number} 余弦相似度（[-1, 1]）。
 */
export function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new InvalidInputError(`cosine similarity requires equal-length vectors (got ${a.length} vs ${b.length})`)
  }
  let dot = 0
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i]
  return dot
}

/**
 * 确定性伪嵌入 Provider（默认实现面）：按 token/字符哈希生成固定维度单位向量。
 * 仅作接口级测试/演示与零依赖语义召回的最小用例；真实嵌入由可选 provider 提供。
 */
export class FakeEmbeddingProvider {
  /**
   * @param {object} [opts] - 覆盖项。
   * @param {string} [opts.id] - provider id（默认 'fake-hash'）。
   * @param {string} [opts.name] - 人类可读名称。
   * @param {string} [opts.description] - 一句话说明。
   * @param {number} [opts.dimensions] - 向量维度（默认 64）。
   */
  constructor(opts = {}) {
    this.id = opts.id ?? 'fake-hash'
    this.name = opts.name ?? 'Fake hash embedding'
    this.description = opts.description ?? 'Deterministic token/character hashing into a fixed-dimension unit vector; interface-level demo, not semantic'
    this.dimensions = opts.dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS
  }

  /**
   * 批量嵌入（文本数组 → 等长向量数组）。
   * @param {string[]} texts - 文本数组。
   * @returns {number[][]} 等长向量数组（每向量长 dimensions）。
   */
  embed(texts) {
    if (!Array.isArray(texts)) {
      throw new InvalidInputError('embedding embed() requires an array of strings')
    }
    return texts.map((text) => hashEmbed(text, this.dimensions))
  }

  /**
   * 单条嵌入。
   * @param {string} text - 文本。
   * @returns {number[]} 单位向量。
   */
  embedOne(text) {
    return hashEmbed(text, this.dimensions)
  }
}

/**
 * 嵌入 Provider 注册表。协议面：register（可逆）/list/get/resolve。
 * 注册表自身无副作用：生命周期由调用方（index.mjs 的 ctx.effect）管理。
 */
export class EmbeddingProviderRegistry {
  constructor() {
    /** @type {Map<string, EmbeddingProvider>} */
    this.providers = new Map()
  }

  /**
   * 注册 provider（返回 disposer；同 id 重复注册响亮失败）。
   * @param {EmbeddingProvider} provider - provider 定义。
   * @returns {() => void} disposer：调用即注销。
   */
  register(provider) {
    this.#validate(provider)
    if (this.providers.has(provider.id)) {
      throw new InvalidInputError(`embedding provider ${JSON.stringify(provider.id)} is already registered`)
    }
    this.providers.set(provider.id, provider)
    return () => {
      if (this.providers.get(provider.id) === provider) this.providers.delete(provider.id)
    }
  }

  /**
   * 已注册 provider 的描述列表（按 id 排序，输出稳定）。
   * @returns {Array<{id: string, name: string, description: string, dimensions: number}>}。
   */
  list() {
    return [...this.providers.values()]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((provider) => ({
        id: provider.id,
        name: provider.name,
        description: provider.description,
        dimensions: provider.dimensions,
      }))
  }

  /**
   * 按 id 取 provider（缺省返回 undefined；调用方据此优雅降级）。
   * @param {string} id - provider id。
   * @returns {EmbeddingProvider | undefined} provider 或 undefined。
   */
  get(id) {
    return this.providers.get(id)
  }

  /**
   * 按 id 取 provider（缺失响亮失败；显式要求某个 provider 的调用方用此面）。
   * @param {string} id - provider id。
   * @returns {EmbeddingProvider} provider。
   */
  resolve(id) {
    const provider = this.providers.get(id)
    if (provider === undefined) throw new EmbeddingNotFoundError(id)
    return provider
  }

  /** 契约校验（注册期响亮失败，不把坏 provider 放进表里）。 */
  #validate(/** @type {EmbeddingProvider} */ provider) {
    if (provider === null || typeof provider !== 'object') {
      throw new InvalidInputError('embedding provider must be an object')
    }
    if (typeof provider.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(provider.id)) {
      throw new InvalidInputError('embedding provider id must be a lowercase kebab-case string')
    }
    if (typeof provider.name !== 'string' || provider.name.length === 0) {
      throw new InvalidInputError('embedding provider name must be a non-empty string')
    }
    if (typeof provider.description !== 'string' || provider.description.length === 0) {
      throw new InvalidInputError('embedding provider description must be a non-empty string')
    }
    if (!Number.isInteger(provider.dimensions) || provider.dimensions <= 0) {
      throw new InvalidInputError('embedding provider dimensions must be a positive integer')
    }
    if (typeof provider.embed !== 'function') {
      throw new InvalidInputError('embedding provider must provide an embed() function')
    }
  }
}
