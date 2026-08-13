// lib/extract.mjs — 会话事件文本抽取（零 DSH 依赖）。
//
// memory_recall 的历史片段显示用：从已知第一方事件形状里提取可读文本。
// 只用于搜索结果片段（显示截断允许）；记忆条目的存储与审计绝不经过本函数。

/**
 * 从会话事件里提取可读文本（记忆召回的历史片段用）。
 * @param {object} event - SessionEvent 形状（{type, data}）。
 * @returns {string} 新行拼接的可读文本；不认识的事件返回空串。
 */
export function extractEventText(event) {
  const data = event?.data
  if (data === null || typeof data !== 'object') {
    return typeof data === 'string' ? data : ''
  }
  // user/message 与 assistant/message：content 文本块
  if (Array.isArray(data.content)) {
    return contentText(data.content)
  }
  // tool/result（及携带 message 的其它事件）
  if (data.message !== null && typeof data.message === 'object') {
    if (Array.isArray(data.message.content)) return contentText(data.message.content)
    if (typeof data.message.text === 'string') return data.message.text
  }
  // tool/call：工具名 + 原始参数
  if (typeof data.name === 'string' && typeof data.arguments === 'string') {
    return `${data.name} ${data.arguments}`
  }
  // todo/write：任务清单
  if (Array.isArray(data.todos)) {
    return data.todos.map((item) => item.content).join('\n')
  }
  // request/header 等：渲染文本字段
  if (typeof data.text === 'string') return data.text
  return ''
}

/** content 文本块拼接（跳过非文本块）。 */
function contentText(content) {
  const parts = []
  for (const part of content) {
    if (part !== null && typeof part === 'object' && typeof part.text === 'string' && part.text.length > 0) {
      parts.push(part.text)
    }
  }
  return parts.join('\n')
}
