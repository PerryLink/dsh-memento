// lib/registry.mjs — dsh-memory-protocol v1 适配器注册表（零 DSH 依赖）。
//
// 第三方记忆插件把自己的 store 适配进协议：注册 {id, adapt(payload), export(entries)}
// 适配器后，导入（外部格式 → 协议条目，走审批）与导出（协议条目 → 外部格式，只读）
// 都经本注册表统一调度。注册返回 disposer（可逆），id 冲突响亮失败；未知 id 或
// 非法载荷结构化报错，绝不静默降级。

import { AdapterNotFoundError, AdapterPayloadError, InvalidInputError, MemoryError } from './errors.mjs'

/**
 * @typedef {object} MemoryAdapter - 适配器契约（第三方插件实现面）。
 * @property {string} id - 唯一适配器 id（小写 kebab-case）。
 * @property {string} name - 人类可读名称。
 * @property {string} description - 一句话说明转换方向与适用格式。
 * @property {string} version - 适配器自身版本（字符串，如 '1.0.0'）。
 * @property {string[]} importFormats - 可导入的外部格式标签（如 ['mem0-facts']）。
 * @property {string} exportFormat - 导出产出的外部格式标签。
 * @property {(payload: unknown) => {entries: Array<import('../types.js').MemoryEntryInput>}} adapt - 外部载荷 → 协议条目输入。
 * @property {(entries: Array<import('../types.js').MemoryEntry>) => unknown} export - 协议条目 → 外部载荷（JSON 安全）。
 */

/**
 * 适配器注册表。协议面：register（可逆）/list/adapt/export。
 * 注册表自身无副作用：生命周期由调用方（index.mjs 的 ctx.effect）管理。
 */
export class MemoryAdapterRegistry {
  constructor() {
    /** @type {Map<string, MemoryAdapter>} */
    this.adapters = new Map()
  }

  /**
   * 注册适配器（返回 disposer；同 id 重复注册响亮失败）。
   * @param {MemoryAdapter} adapter - 适配器定义。
   * @returns {() => void} disposer：调用即注销。
   */
  register(adapter) {
    this.#validateAdapter(adapter)
    if (this.adapters.has(adapter.id)) {
      throw new InvalidInputError(`memory adapter ${JSON.stringify(adapter.id)} is already registered`)
    }
    this.adapters.set(adapter.id, adapter)
    return () => {
      if (this.adapters.get(adapter.id) === adapter) this.adapters.delete(adapter.id)
    }
  }

  /**
   * 已注册适配器的描述列表（按 id 排序，输出稳定）。
   * @returns {Array<{id: string, name: string, description: string, version: string, importFormats: string[], exportFormat: string}>}。
   */
  list() {
    return [...this.adapters.values()]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((adapter) => ({
        id: adapter.id,
        name: adapter.name,
        description: adapter.description,
        version: adapter.version,
        importFormats: adapter.importFormats,
        exportFormat: adapter.exportFormat,
      }))
  }

  /**
   * 外部载荷 → 协议条目输入（未知 id / 非法载荷响亮失败）。
   * @param {string} adapterId - 适配器 id。
   * @param {unknown} payload - 外部格式载荷。
   * @returns {{entries: Array<import('../types.js').MemoryEntryInput>}} 协议条目输入（调用方经 seed 走审批落库）。
   */
  adapt(adapterId, payload) {
    const adapter = this.adapters.get(adapterId)
    if (adapter === undefined) throw new AdapterNotFoundError(adapterId)
    try {
      return adapter.adapt(payload)
    } catch (error) {
      if (error instanceof MemoryError) throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new AdapterPayloadError(adapterId, `adapt failed: ${message}`)
    }
  }

  /**
   * 协议条目 → 外部格式载荷（只读转换；持久化由调用方的写路径负责）。
   * @param {string} adapterId - 适配器 id。
   * @param {Array<import('../types.js').MemoryEntry>} entries - 协议条目。
   * @returns {unknown} 外部格式载荷（JSON 安全）。
   */
  export(adapterId, entries) {
    const adapter = this.adapters.get(adapterId)
    if (adapter === undefined) throw new AdapterNotFoundError(adapterId)
    try {
      return adapter.export(entries)
    } catch (error) {
      if (error instanceof MemoryError) throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new AdapterPayloadError(adapterId, `export failed: ${message}`)
    }
  }

  /** 适配器契约校验（注册期响亮失败，不把坏适配器放进表里）。 */
  #validateAdapter(/** @type {MemoryAdapter} */ adapter) {
    if (adapter === null || typeof adapter !== 'object') {
      throw new InvalidInputError('memory adapter must be an object')
    }
    if (typeof adapter.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(adapter.id)) {
      throw new InvalidInputError('memory adapter id must be a lowercase kebab-case string')
    }
    if (typeof adapter.name !== 'string' || adapter.name.length === 0) {
      throw new InvalidInputError('memory adapter name must be a non-empty string')
    }
    if (typeof adapter.description !== 'string' || adapter.description.length === 0) {
      throw new InvalidInputError('memory adapter description must be a non-empty string')
    }
    if (typeof adapter.version !== 'string' || adapter.version.length === 0) {
      throw new InvalidInputError('memory adapter version must be a non-empty string')
    }
    if (!Array.isArray(adapter.importFormats) || adapter.importFormats.some((format) => typeof format !== 'string' || format.length === 0)) {
      throw new InvalidInputError('memory adapter importFormats must be a non-empty string array')
    }
    if (typeof adapter.exportFormat !== 'string' || adapter.exportFormat.length === 0) {
      throw new InvalidInputError('memory adapter exportFormat must be a non-empty string')
    }
    if (typeof adapter.adapt !== 'function' || typeof adapter.export !== 'function') {
      throw new InvalidInputError('memory adapter must provide adapt() and export() functions')
    }
  }
}
