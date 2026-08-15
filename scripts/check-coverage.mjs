// scripts/check-coverage.mjs — 覆盖率门（CI 与本地共用）。
//
// 用 node:test 内置覆盖率跑全量测试，解析文本报告并断言行覆盖率阈值：
// - lib/*.mjs ≥ 90%（Provider 与纯逻辑是核心面）
// - index.mjs ≥ 85%（host 面含 V2 观察面分支）
// - all files ≥ 90%
// 阈值是仓库门政策（gate policy），不是部署可调参数；提升门槛时同步更新
// README 的 Development 小节。
// parseReport 单独导出：Node 22（'# ' 前缀）与 Node 24（'ℹ ' 前缀）两种
// 报告格式都有 fixture 测试锁定（test/coverage-report.test.mjs），避免
// 未来 Node 版本改格式时 CI 静默变红。
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const THRESHOLDS = [
  { predicate: (/** @type {string} */ name) => name.startsWith('lib/'), line: 90, label: 'lib/*' },
  { predicate: (/** @type {string} */ name) => name === 'index.mjs', line: 85, label: 'index.mjs' },
  { predicate: (/** @type {string} */ name) => name === 'all files', line: 90, label: 'all files' },
]

/**
 * 解析覆盖报告行：返回 { rows, sawAny }，rows = [{qualified, line}]。
 * 兼容 Node 22（'# ' 前缀）与 Node 24（'ℹ ' 前缀，多 start/end/tests 标记行）。
 * @param {string} stdout - node --test --experimental-test-coverage 输出。
 * @returns {{rows: Array<{qualified: string, line: number}>, sawAny: boolean}}。
 */
export function parseReport(stdout) {
  const rows = []
  const stack = []
  let sawAny = false
  for (const raw of stdout.split('\n')) {
    const prefix = /^(?:# |ℹ )/.exec(raw)
    if (prefix === null) continue
    const body = raw.slice(prefix[0].length)
    if (body.startsWith('start of coverage report') || body.startsWith('end of coverage report') || /^tests \d+$/.test(body)) continue
    const indent = (body.match(/^ */)[0]).length
    const cells = body.split('|').map((/** @type {string} */ cell) => cell.trim())
    const name = cells[0]
    if (name.startsWith('-')) continue // 表格分隔线
    if (!body.includes(' | ')) {
      // 纯分组行（如 `# lib`）：入栈。
      stack.length = indent
      stack.push(name)
      continue
    }
    const linePercent = cells[1] === '' ? NaN : Number(cells[1])
    if (!Number.isFinite(linePercent)) {
      // 空百分比 = 分组行（如 `# lib | | |`）→ 入栈；否则是表头行（`# file | line % ...`）→ 仅重置深度。
      stack.length = indent
      if (cells[1] === '') stack.push(name)
      continue
    }
    const qualified = [...stack.slice(0, indent), name].join('/')
    rows.push({ qualified, line: linePercent })
    sawAny = true
  }
  return { rows, sawAny }
}

/** 主流程（直接执行时运行；被 import 做 fixture 测试时跳过）。 */
function main() {
  const result = spawnSync(
    process.execPath,
    ['--test', '--experimental-test-coverage', 'test/*.test.mjs'],
    { cwd: ROOT, encoding: 'utf8', windowsHide: true },
  )
  const stdout = result.stdout ?? ''
  if (result.status !== 0) {
    console.error('coverage run failed (tests did not pass)')
    process.stdout.write(stdout)
    process.stderr.write(result.stderr ?? '')
    process.exit(result.status ?? 1)
  }

  const { rows, sawAny } = parseReport(stdout)
  if (!sawAny) {
    console.error('coverage report not found in test output (Node reporter format changed?)')
    process.stdout.write(stdout)
    process.exit(1)
  }

  let failed = 0
  for (const { predicate, line: minimum, label } of THRESHOLDS) {
    const matches = rows.filter((row) => predicate(row.qualified))
    if (matches.length === 0) {
      console.error(`FAIL  ${label}: no coverage row found (reporter format changed?)`)
      failed += 1
      continue
    }
    for (const row of matches) {
      const ok = row.line >= minimum
      console.log(`${ok ? 'OK   ' : 'FAIL '} ${row.qualified}  line ${row.line.toFixed(2)}% (min ${minimum}%)`)
      if (!ok) failed += 1
    }
  }
  if (failed === 0) {
    console.log('ALL PASS')
    process.exit(0)
  }
  console.error(`${failed} coverage threshold(s) failed`)
  process.exit(1)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
