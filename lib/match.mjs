// lib/match.mjs — 唯一子串匹配（零 DSH 依赖）。
//
// replace/remove 的定位语义：在同 (track, scope) 的条目文本里做大小写不敏感
// 子串匹配（ASCII 折叠；CJK 无大小写不受影响）。零命中 → not-found；多命中 →
// ambiguous（带候选清单，要求模型给更具体的唯一子串）；恰一命中 → ok。
// 不做 FTS/模糊匹配（小语料；FTS5 trigram 无法索引单字 CJK 字符，见 ARCHITECTURE）。

/**
 * 在候选条目里按唯一子串定位（大小写不敏感）。
 * @param {Array<{id: string, text: string}>} entries - 已按 track+scope 过滤的候选条目。
 * @param {string} match - 目标子串（调用方保证非空）。
 * @returns {{kind: 'ok', entry: {id: string, text: string}}
 *   | {kind: 'not-found'}
 *   | {kind: 'ambiguous', candidates: Array<{id: string, text: string}>}} 纯函数结果，不抛错。
 */
export function findUniqueMatch(entries, match) {
  const lower = match.toLowerCase()
  const hits = entries.filter((entry) => entry.text.toLowerCase().includes(lower))
  if (hits.length === 0) return { kind: 'not-found' }
  if (hits.length > 1) return { kind: 'ambiguous', candidates: hits }
  return { kind: 'ok', entry: hits[0] }
}

/**
 * 把 findUniqueMatch 的结果转成领域错误（store 层使用）。
 * @param {{kind: string, entry?: {id: string, text: string}, candidates?: Array<{id: string, text: string}>}} result - findUniqueMatch 结果。
 * @param {object} ctx - {track, scope, match}，供错误 details 使用。
 * @param {{EntryNotFoundError: new (ctx: object) => Error, AmbiguousMatchError: new (ctx: object) => Error}} errors - 错误类（注入以避免循环依赖）。
 * @returns {{id: string, text: string} | undefined} 命中的条目，或抛 EntryNotFoundError / AmbiguousMatchError。
 */
export function requireUniqueMatch(result, ctx, errors) {
  if (result.kind === 'ok') return result.entry
  if (result.kind === 'ambiguous') {
    const sample = /** @type {Array<{text: string}>} */ (result.candidates).map((candidate) =>
      candidate.text.length > 200 ? `${candidate.text.slice(0, 200)}…` : candidate.text)
    throw new errors.AmbiguousMatchError({
      ...ctx,
      candidates: /** @type {Array<{id: string, text: string}>} */ (result.candidates).length,
      sample,
    })
  }
  throw new errors.EntryNotFoundError(ctx)
}
