// scripts/verify-self-contained.mjs — 拒绝把依赖 spec 指向仓库外
// （file/link/portal/workspace/git/http 路径），保证发布包可从 registry 或
// tarball 安装、无外部引用。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

const failures = /** @type {string[]} */ ([])
const check = (/** @type {any} */ deps, /** @type {string} */ label) => {
  for (const [name, spec] of Object.entries(deps ?? {})) {
    if (/^(?:file|link|portal|workspace|git\+|https?):/iu.test(spec) || spec.startsWith('.') || path.isAbsolute(spec)) {
      failures.push(`${label} "${name}" uses out-of-repo spec ${JSON.stringify(spec)}`)
    }
  }
}
check(pkg.dependencies, 'dependencies')
check(pkg.devDependencies, 'devDependencies')
check(pkg.peerDependencies, 'peerDependencies')

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('self-contained: all dependency specs resolve from the registry')
