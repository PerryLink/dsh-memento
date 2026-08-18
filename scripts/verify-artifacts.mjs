// scripts/verify-artifacts.mjs — JS 形态产物门：断言发布文件齐全、语法检查
// host 面与 lib/ 全部模块、在纯 Node 下 import index.mjs 并核对插件面
// （name === 'memento'、apply 是函数）。防发布包缺文件或混入不可执行语法。
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

// 1. 发布面必需文件（与 package.json `files` 白名单一致的核心产物）。
const required = [
  'index.mjs',
  'types.d.ts',
  'cordis.patch.yml',
]
for (const rel of required) {
  if (!existsSync(path.join(root, rel))) throw new Error(`missing artifact: ${rel}`)
}
const libDir = path.join(root, 'lib')
if (!existsSync(libDir)) throw new Error('missing artifact: lib/')
const libFiles = readdirSync(libDir).filter((name) => name.endsWith('.mjs'))
if (libFiles.length === 0) throw new Error('lib/ contains no .mjs modules')

// 2. 语法检查 host 面 + 每个 lib 模块（纯 Node 解析，不执行）。
for (const rel of ['index.mjs', ...libFiles.map((name) => `lib/${name}`)]) {
  execFileSync(process.execPath, ['--check', path.join(root, rel)], { stdio: 'inherit' })
}

// 3. host 面必须在纯 Node 下可 import（无 tsx、无 checkout paths），且导出
//    唯一 host 面契约：name === 'memento'、apply 为函数。
const index = await import(pathToFileURL(path.join(root, 'index.mjs')).href)
if (index.name !== 'memento' || typeof index.apply !== 'function') {
  throw new Error('index.mjs exports an unexpected plugin face')
}

console.log(`artifacts OK: ${libFiles.length} lib modules + index.mjs syntax-checked and importable`)
