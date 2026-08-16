// test/protocol-conformance/golden.mjs — 黄金参考 Provider（dsh-memento 自己的实现）。
//
// 一致性套件的黄金参考：lib/store.mjs（SQLite Provider）+ lib/protocol.mjs
// （MemoryProtocolCore，写语义参考实现）+ 注入式审批传输。本仓库 CI 以它全绿
// 作为"协议声称"的自我证明；第三方 Provider 用自己的工厂跑同一套用例
// （见本目录 README.md 的 Provider 契约）。

import { openMemoryStore } from '../../lib/store.mjs'
import { MemoryProtocolCore } from '../../lib/protocol.mjs'

/** 一致性用例默认预算（协议预算模型的最小演示值；预算用例自配更小的限）。 */
const CONFORMANCE_BUDGETS = {
  user: { userGlobal: 2000, workspace: 2000 },
  agent: { userGlobal: 4000, workspace: 4000 },
}

/**
 * 黄金 Provider 工厂（一致性 Provider 契约）。
 * @param {object} options - {dbPath, budgets?, gate?}。
 * @param {string} options.dbPath - SQLite 文件路径（runner 每次用例给新临时路径）。
 * @param {object} [options.budgets] - 每轨每层硬字符预算（默认 CONFORMANCE_BUDGETS）。
 * @param {(payload: object, write: object) => Promise<string>} [options.gate] - 审批传输（默认 allowed-once）。
 * @returns {{add: Function, replace: Function, remove: Function, consolidate: Function, seed: Function, query: Function, budgets: Function, listEntries: Function, auditList: Function, close: () => void}} Provider。
 */
export function makeProvider(options) {
  const store = openMemoryStore(options.dbPath)
  const core = new MemoryProtocolCore({
    store,
    budgets: options.budgets ?? CONFORMANCE_BUDGETS,
    writePolicy: 'auto',
    defaultQueryLimit: 20,
    gate: options.gate ?? (async () => 'allowed-once'),
  })
  return {
    add: (input, write) => core.add(input, write),
    replace: (input, write) => core.replace(input, write),
    remove: (input, write) => core.remove(input, write),
    consolidate: (input, write) => core.consolidate(input, write),
    seed: (inputs, write) => core.seed(inputs, write),
    query: (filter, opts) => core.query(filter, opts),
    budgets: () => core.budgets(),
    listEntries: () => store.listEntries(),
    auditList: (limit) => store.auditList(limit),
    close: () => store.close(),
  }
}

export default makeProvider
