// test/composition.test.mjs — 真实 Loader composition 套件（社区五层模型 4–5 层）：
// 独立进程挂载 Loader + Include builtin，读 cordis.yml（真实 service 行 + 插件行 +
// config），证明模块解包、inject 解析、config 应用与注册表贡献。同时携带两类负例：
// 非法 config 按预期原因响亮失败（U4），default 导出以 missing-inject 失败（C2）。
// @module dsh-memento/test/composition.test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runner = join(repositoryRoot, 'scripts', 'loader-runner.mjs')
const entry = join(repositoryRoot, 'index.mjs')

/** One cordis.yml: real service rows, then the plugin row with config. */
function configFor(pluginRow, dbPath, configLines = []) {
  return [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-user-approval'",
    `- name: ${JSON.stringify(pluginRow)}`,
    '  config:',
    `    dbPath: ${JSON.stringify(dbPath)}`,
    ...configLines.map(line => `    ${line}`),
    '',
  ].join('\n')
}

function runRunner(configPath, expected) {
  const result = spawnSync(process.execPath, [runner, configPath, expected], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env },
    timeout: 120_000,
  })
  if (result.error !== undefined) throw result.error
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

const temporaryRoot = mkdtempSync(join(tmpdir(), 'dsh-memento-loader-'))
const dbDir = join(temporaryRoot, 'db')
mkdirSync(dbDir, { recursive: true })

test('Loader composition mounts the plugin and applies its default config', () => {
  const configPath = join(temporaryRoot, 'valid.yml')
  writeFileSync(configPath, configFor(pathToFileURL(entry).href, join(dbDir, 'a.db')))
  const evidence = runRunner(configPath, 'en')
  assert.equal(evidence.status, 0, `stdout:\n${evidence.stdout}\nstderr:\n${evidence.stderr}`)
  const marker = evidence.stdout.match(/DSH_LOADER_RESULT (.+)$/mu)
  const summary = JSON.parse(marker[1])
  assert.equal(summary.memoryService, true)
  assert.ok(summary.tools.includes('memory'))
  assert.ok(summary.tools.includes('memory_recall'))
  assert.equal(summary.queryOk, true)
})

test('Loader composition applies the special config value (language: zh)', () => {
  const configPath = join(temporaryRoot, 'zh.yml')
  writeFileSync(configPath, configFor(pathToFileURL(entry).href, join(dbDir, 'b.db'), [
    "language: 'zh'",
  ]))
  const evidence = runRunner(configPath, 'zh')
  assert.equal(evidence.status, 0, `stdout:\n${evidence.stdout}\nstderr:\n${evidence.stderr}`)
  const marker = evidence.stdout.match(/DSH_LOADER_RESULT (.+)$/mu)
  const summary = JSON.parse(marker[1])
  assert.equal(summary.language, 'zh')
})

// 真实热重载验证（dshWorkshop lifecycle.activation: hot-reload 的证据）：经
// Include.refresh() 事务（HMR watcher 同一路径）改写 language 两次，fiber
// 随之重启，面板路由卸载后重注册不抛 duplicate route。行携带稳定 id——无 id
// 的行在每次配置读取后被视为删除+新增而整体重挂。
test('Loader hot-reload: a language config edit restarts the fiber and keeps the panel routes clean', () => {
  const fixture = join(repositoryRoot, 'test', 'fixtures', 'mock-webserver.mjs')
  const configPath = join(temporaryRoot, 'reload.yml')
  writeFileSync(configPath, [
    "- id: sysprompt",
    "  name: '@deepseek-ai/dsh-system-prompt'",
    "- id: tools",
    "  name: '@deepseek-ai/dsh-tools'",
    "- id: approval",
    "  name: '@deepseek-ai/dsh-user-approval'",
    "- id: mock-webserver",
    `  name: ${JSON.stringify(pathToFileURL(fixture).href)}`,
    "- id: memento",
    `  name: ${JSON.stringify(pathToFileURL(entry).href)}`,
    '  config:',
    `    dbPath: ${JSON.stringify(join(dbDir, 'reload.db'))}`,
    "    language: 'en'",
    '',
  ].join('\n'))
  const evidence = runRunner(configPath, 'reload')
  assert.equal(evidence.status, 0, `stdout:\n${evidence.stdout}\nstderr:\n${evidence.stderr}`)
  const marker = evidence.stdout.match(/DSH_LOADER_RESULT (.+)$/mu)
  const summary = JSON.parse(marker[1])
  assert.equal(summary.cycled, true)
  assert.equal(summary.routes, 3)
})

test('invalid config fails loud through the Loader for the expected reason', () => {
  const cases = [
    { lines: ["enabled: 'yes'"], reason: /expected boolean/u },
    { lines: ["writePolicy: 'bogus'"], reason: /writePolicy/u },
    { lines: ["language: 'fr'"], reason: /language/u },
    { lines: ['maxEntriesPerQuery: 0'], reason: /maxEntriesPerQuery/u },
  ]
  const entryUrl = pathToFileURL(entry).href
  for (const entryCase of cases) {
    const configPath = join(temporaryRoot, 'invalid.yml')
    writeFileSync(configPath, configFor(entryUrl, join(dbDir, 'invalid.db'), entryCase.lines))
    const evidence = runRunner(configPath, 'en')
    assert.notEqual(evidence.status, 0, `invalid config unexpectedly mounted:\n${entryCase.lines.join('\n')}`)
    assert.match(evidence.stderr, entryCase.reason, `failed for the wrong reason:\n${evidence.stderr}`)
  }
})

test('a default export fails through the Loader with the missing-inject reason', () => {
  const wrapper = join(temporaryRoot, 'default-export.mjs')
  const builtUrl = pathToFileURL(entry).href
  writeFileSync(wrapper, [
    `export { name, inject, Config, apply } from ${JSON.stringify(builtUrl)}`,
    `export { apply as default } from ${JSON.stringify(builtUrl)}`,
    '',
  ].join('\n'))
  const configPath = join(temporaryRoot, 'invalid-default.yml')
  writeFileSync(configPath, configFor(pathToFileURL(wrapper).href, join(dbDir, 'default.db')))
  const evidence = runRunner(configPath, 'en')
  assert.notEqual(evidence.status, 0, 'default-export wrapper unexpectedly mounted')
  assert.match(evidence.stderr, /without inject/u, `failed for the wrong reason:\n${evidence.stderr}`)
})

test.after(() => {
  rmSync(temporaryRoot, { recursive: true, force: true })
})
