// test/protocol-conformance/run.mjs — 一致性套件 runner + CLI。
//
// 两种用法：
// 1. 本仓库 CI/本地：node test/protocol-conformance/run.mjs（默认黄金参考 Provider）
// 2. 第三方 Provider：node test/protocol-conformance/run.mjs --provider ./my-factory.mjs
//    工厂模块默认导出 makeProvider({dbPath, budgets, gate}) → Provider（契约见 README.md）。
//
// 每个用例拿全新 Provider 实例（独立临时目录），失败用例记录消息，全部跑完
// 出汇总报告；退出码 = 失败用例数 > 0 ? 1 : 0。临时目录（自己 mkdtemp 创建）
// 收尾时清理，绝不触碰其它路径。

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONFORMANCE_CASES } from './suite.mjs'
import { PROTOCOL_URI } from '../../lib/protocol.mjs'

/**
 * 跑全套一致性用例。
 * @param {(options: object) => object} makeProvider - Provider 工厂（契约见 README.md）。
 * @param {{filter?: string, log?: (line: string) => void}} [options] - {filter: id 前缀过滤, log}。
 * @returns {Promise<{protocol: string, total: number, passed: number, failed: number, results: Array<{id: string, section: string, name: string, status: 'pass' | 'fail', error?: string}>}>} 报告。
 */
export async function runConformance(makeProvider, options = {}) {
  /** @type {string[]} */
  const tempDirs = []
  const factory = (/** @type {object} */ providerOptions = {}) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dsh-memento-conformance-'))
    tempDirs.push(dir)
    return makeProvider({ dbPath: path.join(dir, 'memory.db'), ...providerOptions })
  }
  const selected = options.filter === undefined
    ? CONFORMANCE_CASES
    : CONFORMANCE_CASES.filter((testCase) => testCase.id.startsWith(options.filter))
  const results = []
  for (const testCase of selected) {
    /** @type {object | undefined} */
    let provider
    try {
      provider = factory(testCase.providerOptions)
      await testCase.run(provider, { makeProvider: factory })
      results.push({ id: testCase.id, section: testCase.section, name: testCase.name, status: /** @type {'pass'} */ ('pass') })
      options.log?.(`ok   ${testCase.id}  ${testCase.name}`)
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      results.push({ id: testCase.id, section: testCase.section, name: testCase.name, status: /** @type {'fail'} */ ('fail'), error: message })
      options.log?.(`FAIL ${testCase.id}  ${testCase.name}\n     ${message}`)
    } finally {
      try {
        provider?.close?.()
      } catch {
        // 收尾失败不掩盖用例本身的结果；临时目录仍会清理。
      }
    }
  }
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // 已关闭的库文件应可删；失败只影响临时目录残留，不影响报告。
    }
  }
  const passed = results.filter((result) => result.status === 'pass').length
  const failed = results.length - passed
  return { protocol: PROTOCOL_URI, total: results.length, passed, failed, results }
}

/** CLI 入口（直接执行时运行；被 import 时跳过）。 */
async function main() {
  const argv = process.argv.slice(2)
  let providerPath
  let filter
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--provider') {
      providerPath = argv[index + 1]
      index += 1
    } else if (argv[index] === '--filter') {
      filter = argv[index + 1]
      index += 1
    }
  }
  /** @type {(options: object) => object} */
  let makeProvider
  if (providerPath === undefined) {
    makeProvider = (await import('./golden.mjs')).makeProvider
  } else {
    const resolved = path.resolve(providerPath)
    const loaded = await import(pathToFileURL(resolved).href)
    makeProvider = typeof loaded.makeProvider === 'function'
      ? loaded.makeProvider
      : (typeof loaded.default === 'function' ? loaded.default : undefined)
    if (makeProvider === undefined) {
      console.error(`provider factory module ${providerPath} must export makeProvider(options)`)
      process.exit(2)
    }
  }
  const json = argv.includes('--json')
  const report = await runConformance(makeProvider, {
    ...(filter === undefined ? {} : { filter }),
    ...(json ? {} : { log: (line) => console.log(line) }),
  })
  if (json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`${report.protocol}: ${report.passed}/${report.total} cases passed (${report.failed} failed)`)
  }
  process.exit(report.failed === 0 ? 0 : 1)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
