#!/usr/bin/env node
// scripts/typecheck-checkout.mjs — checkout 面类型尺子（第二把尺子的第一把）。
//
// 两把尺子量的是**两个不同的类型宇宙**，这是它们存在的唯一理由：
// - 本脚本（tsconfig.check.json）：`paths` 指向 D:\deepseek-harness 这颗 checkout 的
//   已构建类型面（当前 checkout = dsh-v0.1.6-alpha.2）。量的是"宿主源码线的形状"。
// - `typecheck:ci`（tsconfig.check.ci.json）：无 `paths`，量 npm 已发布线
//   （devDependencies 钉住的那版 node_modules）。量的是"用户实际装到的形状"。
// 只有两把都跑，才能同时发现"对照源码写对了但发布线还没有"和"发布线有、源码线已删"。
//
// checkout 只存在于开发者机器上：runner（GitHub Actions）没有它，此时本尺子
// **不可验证**——打印一行并 exit 0，绝不给 CI 装一个恒红步骤。缺 checkout 不等于
// 类型面正确，只等于这一把尺子这次没量；`typecheck:ci` 仍然照常量。
//
// 退出码：0 = 通过或不可验证；2 = 类型错误（tsc 原样透传非零码）。

import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** checkout 面里被 paths 引用的类型入口；缺任意一个都视为"本机不可验证"。 */
const CHECKOUT_ROOT = 'D:/deepseek-harness'
const REQUIRED_TYPE_FACES = [
  'vendor/cordis/lib/types/index.d.ts',
  'vendor/include/lib/types/index.d.ts',
  'vendor/loader/lib/types/index.d.ts',
  'vendor/schemastery/lib/types/index.d.ts',
  'packages/core/session/lib/types/index.d.ts',
  'packages/core/tools/lib/types/index.d.ts',
  'packages/settings/settings/lib/types/index.d.ts',
  'packages/llm/llm/lib/types/index.d.ts',
  'packages/core/agent/lib/types/index.d.ts',
  'packages/core/scope/lib/types/index.d.ts',
]

const missing = REQUIRED_TYPE_FACES.filter((relative) => !existsSync(path.join(CHECKOUT_ROOT, relative)))
if (missing.length > 0) {
  console.log(`typecheck(checkout 面): 不可验证 —— ${CHECKOUT_ROOT} 缺 ${missing.length} 个类型入口（例如 ${missing[0]}）。`)
  console.log('  本机没有宿主 checkout（CI runner 属此类）。第二把尺子请跑 npm run typecheck:ci（已发布线）。')
  process.exit(0)
}

const result = spawnSync('npx', ['tsc', '-p', path.join(repoRoot, 'tsconfig.check.json')], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
process.exit(result.status ?? 1)
