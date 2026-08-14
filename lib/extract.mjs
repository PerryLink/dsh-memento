// lib/extract.mjs — 会话事件文本抽取（零 DSH 依赖）。
//
// memory_recall 的历史片段显示用：从已知第一方事件形状里提取可读文本。
// 只用于搜索结果片段（显示截断允许）；记忆条目的存储与审计绝不经过本函数。

/**
 * 从会话事件里提取可读文本（记忆召回的历史片段用）。
 * @param {unknown} event - SessionEvent 形状（{type, data}）；防御性解析，形状不信任。
 * @returns {string} 新行拼接的可读文本；不认识的事件返回空串。
 */
export function extractEventText(event) {
  if (event === null || typeof event !== 'object') return ''
  const data = /** @type {{data?: unknown}} */ (event).data
  if (data === null || typeof data !== 'object') {
    return typeof data === 'string' ? data : ''
  }
  const record = /** @type {{content?: unknown, message?: unknown, name?: unknown, arguments?: unknown, todos?: unknown, summary?: unknown, text?: unknown}} */ (data)
  // user/message 与 assistant/message：content 文本块
  if (Array.isArray(record.content)) {
    return contentText(/** @type {unknown[]} */ (record.content))
  }
  // compaction/summary：summary 文本块
  if (Array.isArray(record.summary)) {
    return contentText(/** @type {unknown[]} */ (record.summary))
  }
  // tool/result（及携带 message 的其它事件）
  if (record.message !== null && typeof record.message === 'object') {
    const message = /** @type {{content?: unknown, text?: unknown}} */ (record.message)
    if (Array.isArray(message.content)) return contentText(/** @type {unknown[]} */ (message.content))
    if (typeof message.text === 'string') return message.text
  }
  // tool/call：工具名 + 原始参数
  if (typeof record.name === 'string' && typeof record.arguments === 'string') {
    return `${record.name} ${record.arguments}`
  }
  // todo/write：任务清单
  if (Array.isArray(record.todos)) {
    return /** @type {Array<{content: string}>} */ (record.todos).map((item) => item.content).join('\n')
  }
  // request/header 等：渲染文本字段
  if (typeof record.text === 'string') return record.text
  return ''
}

/** content 文本块拼接（跳过非文本块）。 */
function contentText(/** @type {unknown[]} */ content) {
  const parts = []
  for (const part of content) {
    if (part !== null && typeof part === 'object' && typeof /** @type {{text?: unknown}} */ (part).text === 'string' && /** @type {{text: string}} */ (part).text.length > 0) {
      parts.push(/** @type {{text: string}} */ (part).text)
    }
  }
  return parts.join('\n')
}
