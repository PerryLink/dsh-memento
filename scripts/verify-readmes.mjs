// scripts/verify-readmes.mjs — 五语 README 一致性门（CI 与本地共用）。
// 机械检查：标题、语言互链、Topics、安装命令、库路径、许可证链接、
// 关键配置/工具 token、恰好一个结尾换行。行为变更同 commit 更新五语 README
// 的红线由本门在 CI 兜底。
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FILES = ['README.md', 'README.zh.md', 'README.es.md', 'README.pt.md', 'README.hi.md']
const SWITCHER = '[English](README.md) · [中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)'

let failed = 0
for (const file of FILES) {
  const filePath = path.join(ROOT, file)
  if (!existsSync(filePath)) {
    console.log(`MISSING  ${file}`)
    failed += 1
    continue
  }
  const text = readFileSync(filePath, 'utf8')
  const checks = [
    ['title', text.startsWith('# dsh-memento')],
    ['switcher', text.includes(SWITCHER)],
    ['topic dsh', /`dsh`/.test(text)],
    ['topic dsh-plugin', /`dsh-plugin`/.test(text)],
    ['install cmd', text.includes('dsh plugin --profile')],
    ['install gh url', text.includes('git+https://github.com/PerryLink/dsh-memento.git')],
    ['no unpublished npm claim', !text.includes('once published')],
    ['db path', text.includes('$DSH_HOME/dsh-memento/memory.db')],
    ['license link', text.includes('[LICENSE](LICENSE)')],
    ['writePolicy token', text.includes('`writePolicy`')],
    ['memory_recall token', text.includes('`memory_recall`')],
    ['commandListLimit token', text.includes('`commandListLimit`')],
    ['commandAuditLimit token', text.includes('`commandAuditLimit`')],
    ['trailing newline', text.endsWith('\n') && !text.endsWith('\n\n')],
  ]
  const bad = checks.filter(([, ok]) => !ok).map(([name]) => name)
  if (bad.length === 0) console.log(`OK       ${file} (${text.length} chars)`)
  else {
    console.log(`FAIL     ${file}: ${bad.join(', ')}`)
    failed += 1
  }
}
console.log(failed === 0 ? 'ALL PASS' : `${failed} file(s) failed`)
process.exit(failed === 0 ? 0 : 1)
