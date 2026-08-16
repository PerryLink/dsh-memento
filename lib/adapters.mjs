// lib/adapters.mjs — dsh-memory-protocol v1 参考适配器（零 DSH 依赖）。
//
// 三个参考适配器演示第三方记忆形态如何接入协议（docs/adapters-guide.md 有接入指南）：
// - mem0：mem0 的 facts 集合（每项 {memory, metadata?...}）⇄ 协议条目。
// - hermes-memory-md：Hermes memory.md 的「## 小节 + 项目符号」格式 ⇄ 协议条目。
// - claude-code-memory-md：CLAUDE.md 的「标题/项目符号/段落」格式 ⇄ 协议条目。
//
// 适配器只做数据转换，绝不调用模型做摘要/抽取——载荷里没有事实条目时响亮失败，
// 由调用方先提取再喂（协议是存储互操作面，不是推理面）。全部转换幂等、无副作用。

import { AdapterPayloadError } from './errors.mjs'

/**
 * 把任意非字符串载荷包成一致的文本解析错误。
 * @param {string} adapterId - 适配器 id。
 * @param {string} detail - 具体原因。
 * @returns {AdapterPayloadError}。
 */
function payloadError(adapterId, detail) {
  return new AdapterPayloadError(adapterId, detail)
}

/** mem0 facts 形状：每项 {memory, id?, user_id?, metadata?, created_at?, updated_at?}。 */
const MEM0_ADAPTER = /** @type {import('./registry.mjs').MemoryAdapter} */ ({
  id: 'mem0',
  name: 'mem0 facts',
  description: 'Converts mem0 fact collections (objects with a "memory" field) to protocol entries and back. Conversion only — it never runs model extraction, so feed it facts, not raw conversations.',
  version: '1.0.0',
  importFormats: ['mem0-facts'],
  exportFormat: 'mem0-facts',

  /** @param {unknown} payload - facts 数组或 {facts: [...]}。 */
  adapt(payload) {
    const facts = unwrap(payload, 'mem0', ['facts'])
    if (!Array.isArray(facts)) {
      throw payloadError('mem0', 'payload must be a facts array or {facts: [...]} (conversion only — raw "messages" arrays are not extracted; run extraction first)')
    }
    const entries = []
    for (const fact of facts) {
      if (fact === null || typeof fact !== 'object') {
        throw payloadError('mem0', 'each fact must be an object with a non-empty "memory" string')
      }
      const record = /** @type {{[key: string]: unknown}} */ (fact)
      if (typeof record.memory !== 'string' || record.memory.length === 0) {
        throw payloadError('mem0', 'each fact must be an object with a non-empty "memory" string')
      }
      const metadata = record.metadata !== undefined && record.metadata !== null && typeof record.metadata === 'object'
        ? /** @type {{[key: string]: unknown}} */ (record.metadata)
        : {}
      const tags = []
      if (typeof metadata.category === 'string' && metadata.category.length > 0) tags.push(metadata.category)
      if (Array.isArray(metadata.tags)) {
        for (const tag of metadata.tags) {
          if (typeof tag === 'string' && tag.length > 0 && !tags.includes(tag)) tags.push(tag)
        }
      }
      entries.push({
        track: 'user',
        scope: 'user-global',
        text: record.memory,
        source: 'mem0',
        tags,
      })
    }
    return { entries }
  },

  /** @param {Array<import('../types.js').MemoryEntry>} entries - 协议条目。 */
  export(entries) {
    return {
      plugin: 'mem0',
      facts: entries.map((entry) => ({
        memory: entry.text,
        created_at: entry.createdAt,
        updated_at: entry.updatedAt,
        metadata: {
          track: entry.track,
          scope: entry.scope,
          source: entry.source,
          workspace_key: entry.workspaceKey,
          agent_key: entry.agentKey,
          tags: entry.tags,
        },
      })),
    }
  },
})

/** Hermes memory.md：`## 小节` + 项目符号列表；非项目符号的非空行响亮失败（格式约束）。 */
const HERMES_MEMORY_MD_ADAPTER = /** @type {import('./registry.mjs').MemoryAdapter} */ ({
  id: 'hermes-memory-md',
  name: 'Hermes memory.md',
  description: 'Converts Hermes memory.md documents ("## section" headings with bullet lists) to protocol entries (section name becomes a tag) and back to a bullet-form markdown document.',
  version: '1.0.0',
  importFormats: ['hermes-memory-md'],
  exportFormat: 'hermes-memory-md',

  /** @param {unknown} payload - markdown 文本或 {text}。 */
  adapt(payload) {
    const { text, section } = parseMarkdown(payload, 'hermes-memory-md')
    return { entries: adaptBulletMarkdown(text, section, 'hermes-memory-md', true) }
  },

  /** @param {Array<import('../types.js').MemoryEntry>} entries - 协议条目。 */
  export(entries) {
    return { plugin: 'hermes-memory-md', text: exportBulletMarkdown(entries) }
  },
})

/** CLAUDE.md：标题/项目符号/段落皆可为记忆内容；段落按空行分段成条目。 */
const CLAUDE_CODE_MEMORY_MD_ADAPTER = /** @type {import('./registry.mjs').MemoryAdapter} */ ({
  id: 'claude-code-memory-md',
  name: 'CLAUDE.md memory',
  description: 'Converts CLAUDE.md-style memory documents (headings, bullets, and prose paragraphs) to protocol entries and back to a bullet-form markdown document. Each bullet or paragraph becomes one entry; the section name becomes a tag.',
  version: '1.0.0',
  importFormats: ['claude-code-memory-md'],
  exportFormat: 'claude-code-memory-md',

  /** @param {unknown} payload - markdown 文本或 {text}。 */
  adapt(payload) {
    const { text, section } = parseMarkdown(payload, 'claude-code-memory-md')
    return { entries: adaptProseMarkdown(text, section, 'claude-code-memory-md') }
  },

  /** @param {Array<import('../types.js').MemoryEntry>} entries - 协议条目。 */
  export(entries) {
    return { plugin: 'claude-code-memory-md', text: exportBulletMarkdown(entries) }
  },
})

/** 内置参考适配器（注册顺序即文档展示顺序）。 */
export const REFERENCE_ADAPTERS = [MEM0_ADAPTER, HERMES_MEMORY_MD_ADAPTER, CLAUDE_CODE_MEMORY_MD_ADAPTER]

/**
 * 载荷解包：接受裸数组、{<key>: [...]} 信封或 {facts: [...]} 别名；其余响亮失败。
 * @param {unknown} payload - 载荷。
 * @param {string} adapterId - 适配器 id（错误标注用）。
 * @param {string[]} envelopeKeys - 允许的信封键（如 ['facts']）。
 * @returns {unknown} 数组载荷。
 */
function unwrap(payload, adapterId, envelopeKeys) {
  if (Array.isArray(payload)) return payload
  if (payload !== null && typeof payload === 'object') {
    const record = /** @type {{[key: string]: unknown}} */ (payload)
    for (const key of envelopeKeys) {
      if (Array.isArray(record[key])) return record[key]
    }
  }
  throw payloadError(adapterId, `payload must be an array or an envelope with one of: ${envelopeKeys.join(', ')}`)
}

/**
 * markdown 载荷解析：接受字符串或 {text}；按行拆分。
 * @param {unknown} payload - 载荷。
 * @param {string} adapterId - 适配器 id（错误标注用）。
 * @returns {{text: string, section: string}} 文本与当前小节名（'' = 文档开头无小节）。
 */
function parseMarkdown(payload, adapterId) {
  /** @type {string | undefined} */
  let text
  if (typeof payload === 'string') {
    text = payload
  } else if (payload !== null && typeof payload === 'object') {
    const record = /** @type {{[key: string]: unknown}} */ (payload)
    if (typeof record.text === 'string') {
      text = record.text
    }
  }
  if (text === undefined) {
    throw payloadError(adapterId, 'payload must be markdown text or {text: "..."}')
  }
  return { text, section: '' }
}

/**
 * 项目符号型 markdown → 条目（Hermes memory.md 语义：非空非项目符号行响亮失败）。
 * @param {string} text - markdown 文本。
 * @param {string} initialSection - 初始小节名。
 * @param {string} source - 来源标注。
 * @param {boolean} strict - true 时非项目符号内容行报错（格式约束）；false 时当段落处理。
 * @returns {Array<import('../types.js').MemoryEntryInput>} 协议条目输入。
 */
function adaptBulletMarkdown(text, initialSection, source, strict) {
  /** @type {Array<import('../types.js').MemoryEntryInput>} */
  const entries = []
  let section = initialSection
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (line.length === 0 || line.trim().length === 0) continue
    if (line.startsWith('## ')) {
      section = line.slice(3).trim()
      continue
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      const body = line.slice(2).trim()
      if (body.length === 0) continue
      entries.push({
        track: 'user',
        scope: 'user-global',
        text: body,
        source,
        ...(section.length > 0 ? { tags: [section] } : {}),
      })
      continue
    }
    if (strict) {
      throw payloadError(source, `line ${index + 1} is not a bullet ("${line.slice(0, 40)}…"): the memory.md format requires bullet lists; convert prose to bullets first`)
    }
  }
  return entries
}

/**
 * 段落型 markdown → 条目（CLAUDE.md 语义：标题定小节；项目符号每条一条；连续非空行按空行分段成条目）。
 * @param {string} text - markdown 文本。
 * @param {string} initialSection - 初始小节名。
 * @param {string} source - 来源标注。
 * @returns {Array<import('../types.js').MemoryEntryInput>} 协议条目输入。
 */
function adaptProseMarkdown(text, initialSection, source) {
  /** @type {Array<import('../types.js').MemoryEntryInput>} */
  const entries = []
  let section = initialSection
  /** @type {string[]} */
  const paragraph = []
  const flush = () => {
    if (paragraph.length === 0) return
    const body = paragraph.join(' ').trim()
    if (body.length > 0) {
      entries.push({
        track: 'user',
        scope: 'user-global',
        text: body,
        source,
        ...(section.length > 0 ? { tags: [section] } : {}),
      })
    }
    paragraph.length = 0
  }
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    if (line.length === 0 || line.trim().length === 0) {
      flush()
      continue
    }
    if (line.startsWith('## ')) {
      flush()
      section = line.slice(3).trim()
      continue
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      flush()
      const body = line.slice(2).trim()
      if (body.length > 0) {
        entries.push({
          track: 'user',
          scope: 'user-global',
          text: body,
          source,
          ...(section.length > 0 ? { tags: [section] } : {}),
        })
      }
      continue
    }
    paragraph.push(line.trim())
  }
  flush()
  return entries
}

/**
 * 协议条目 → 项目符号型 markdown（按 track/scope 分组出小节；Hermes/CLAUDE 导出共用）。
 * @param {Array<import('../types.js').MemoryEntry>} entries - 协议条目。
 * @returns {string} markdown 文档。
 */
function exportBulletMarkdown(entries) {
  const groups = new Map()
  for (const entry of entries) {
    const key = `${entry.track}/${entry.scope}`
    const list = groups.get(key) ?? []
    list.push(entry)
    groups.set(key, list)
  }
  const sections = [...groups.keys()].sort()
  if (sections.length === 0) return ''
  return sections
    .map((key) => {
      const list = /** @type {Array<import('../types.js').MemoryEntry>} */ (groups.get(key))
      const bullets = list.map((entry) => `- ${entry.text.replaceAll('\n', ' ')}`)
      return `## ${key}\n${bullets.join('\n')}`
    })
    .join('\n\n')
}
