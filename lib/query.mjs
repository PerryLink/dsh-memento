// lib/query.mjs — 记忆检索的"查询词项化 + 多词匹配 + 词频打分"（零依赖）。
//
// 背景：默认检索路径（store.queryEntries，`retrieval.vector=false`）原先用
// `instr(lower(text), lower(?))` 做**整串子串**匹配，导致：
//   - 多词短语词序不同（"mode dark" vs "dark mode"）失手；
//   - 词之间不紧邻（"dark ... mode"）失手。
// 本模块把查询切成词项，多词时要求"每个词项都出现"（AND，顺序无关），并按词频
// + 短语连续性做轻量相关性打分。零依赖、无 FTS（ARCHITECTURE 决策 10：FTS5
// trigram 无法索引单字 CJK、unicode61 把 CJK 连段当一个 token），与既有大小写
// 不敏感子串语义兼容：单词语义与改动前完全一致。
//
// CJK 处理：把连续 CJK 段整体当作一个词项（如 "用户偏好"），避免逐字切分出
// "的/是/在"这类高频单字造成噪声；非 CJK 按空白/标点切成字母数字词。

const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/
const NON_WORD_RE = /[^\p{L}\p{N}]/u

/**
 * 把查询切成去重后的词项数组（顺序保留，已小写、NFKC 归一）。
 * - CJK 连续段 → 一个词项（"用户偏好"）
 * - 其它按空白/标点切分，只保留字母数字词（"dark, mode!" → ["dark","mode"]）
 * - 空/纯标点查询 → []
 * @param {unknown} input - 原始查询。
 * @returns {string[]} 词项数组。
 */
export function tokenizeQuery(input) {
  const text = String(input ?? '').normalize('NFKC').toLowerCase()
  /** @type {string[]} */
  const tokens = []
  let buf = ''
  /** @type {boolean | null} */ let bufCjk = null
  const flush = () => { if (buf.length > 0) { tokens.push(buf); buf = '' } }
  for (const ch of text) {
    if (CJK_RE.test(ch)) {
      if (bufCjk === false) flush()
      buf += ch
      bufCjk = true
    } else if (/\s/.test(ch) || NON_WORD_RE.test(ch)) {
      flush()
      bufCjk = null
    } else {
      if (bufCjk === true) flush()
      buf += ch
      bufCjk = false
    }
  }
  flush()
  // 去重（保序）
  return [...new Set(tokens.filter((token) => token.length > 0))]
}

/**
 * 统计 needle 在 haystack 里出现的（非重叠）次数。
 * @param {string} haystack - 已小写的文本。
 * @param {string} needle - 已小写的词项。
 * @returns {number} 出现次数。
 */
export function countOccurrences(haystack, needle) {
  if (needle.length === 0) return 0
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

/**
 * 多词匹配判定：每个词项都出现在文本中（AND，顺序无关，大小写不敏感）。
 * @param {string} text - 条目文本。
 * @param {string[]} terms - 词项数组。
 * @returns {boolean} 是否全部命中。
 */
export function matchQuery(text, terms) {
  const lower = String(text).toLowerCase()
  return terms.length > 0 && terms.every((term) => {
    const token = String(term).toLowerCase()
    return token.length > 0 && lower.includes(token)
  })
}

/**
 * 相关性打分（多词）：命中所有词项才返回分数，否则 null。
 * 分数 = Σ(词频 × 长度权重) + 短语连续性奖励；词频权重让"多次提及"排前，
 * 短语奖励让"整串连续出现"排在同词项但分散出现的条目之前。
 * @param {string} text - 条目文本。
 * @param {string[]} terms - 词项数组。
 * @param {string} [raw] - 原始查询（用于短语连续性奖励）。
 * @returns {number | null} 相关度分数；未全命中返回 null。
 */
export function scoreEntry(text, terms, raw) {
  const lower = String(text).toLowerCase()
  let score = 0
  for (const term of terms) {
    const token = String(term).toLowerCase()
    const tf = countOccurrences(lower, token)
    if (tf === 0) return null
    score += tf * (1 + Math.min(token.length, 8) / 8)
  }
  if (typeof raw === 'string') {
    const phrase = raw.trim().toLowerCase()
    if (phrase.length > 0 && lower.includes(phrase)) score += 5
  }
  return score
}
