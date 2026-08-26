// test/embedding.test.mjs — embedding Provider seam 单测：伪嵌入确定性/归一化、
// 余弦相似度、FakeEmbeddingProvider、注册表（可逆/冲突/校验/缺失响亮）。

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  hashEmbed,
  l2Normalize,
  cosineSimilarity,
  FakeEmbeddingProvider,
  EmbeddingProviderRegistry,
  DEFAULT_EMBEDDING_DIMENSIONS,
} from '../lib/embedding.mjs'
import { InvalidInputError, EmbeddingNotFoundError } from '../lib/errors.mjs'

function norm(vector) {
  let sum = 0
  for (const value of vector) sum += value * value
  return Math.sqrt(sum)
}

test('hashEmbed：确定性——同一文本两次产出同一向量', () => {
  const a = hashEmbed('用户偏好：回复用中文')
  const b = hashEmbed('用户偏好：回复用中文')
  assert.deepEqual(a, b)
})

test('hashEmbed：固定维度 + 非空文本产出单位向量', () => {
  const vector = hashEmbed('lapsang is the drink')
  assert.equal(vector.length, DEFAULT_EMBEDDING_DIMENSIONS)
  assert.ok(Math.abs(norm(vector) - 1) < 1e-9)
})

test('hashEmbed：大小写不敏感（ASCII 折叠）', () => {
  assert.deepEqual(hashEmbed('Lapsang'), hashEmbed('lapsang'))
})

test('hashEmbed：空/无字母数字文本得到全零向量', () => {
  assert.deepEqual(hashEmbed(''), new Array(DEFAULT_EMBEDDING_DIMENSIONS).fill(0))
  assert.deepEqual(hashEmbed('  \t\n '), new Array(DEFAULT_EMBEDDING_DIMENSIONS).fill(0))
})

test('l2Normalize：非零向量归一化为单位向量，零向量原样返回', () => {
  const normalized = l2Normalize([3, 4])
  assert.ok(Math.abs(norm(normalized) - 1) < 1e-9)
  assert.deepEqual(l2Normalize([0, 0, 0]), [0, 0, 0])
})

test('cosineSimilarity：同 token 集为 1，正交（无重叠）为 0', () => {
  const a = hashEmbed('drink lapsang')
  const b = hashEmbed('lapsang drink')
  assert.ok(Math.abs(cosineSimilarity(a, b) - 1) < 1e-9)
  const c = hashEmbed('quantum gravity')
  assert.ok(Math.abs(cosineSimilarity(a, c)) < 1)
})

test('cosineSimilarity：维度不一致响亮失败', () => {
  assert.throws(() => cosineSimilarity([1, 0], [1, 0, 0]), (error) => error instanceof InvalidInputError)
})

test('FakeEmbeddingProvider：embed 批量 + embedOne 单条，维度与确定性', () => {
  const provider = new FakeEmbeddingProvider()
  assert.equal(provider.id, 'fake-hash')
  assert.equal(provider.dimensions, DEFAULT_EMBEDDING_DIMENSIONS)
  const vectors = provider.embed(['甲', '乙'])
  assert.equal(vectors.length, 2)
  assert.equal(vectors[0].length, DEFAULT_EMBEDDING_DIMENSIONS)
  assert.deepEqual(provider.embedOne('甲'), vectors[0])
  assert.deepEqual(provider.embed(['甲'])[0], vectors[0])
})

test('FakeEmbeddingProvider：embed 非数组响亮失败；维度可覆盖', () => {
  const provider = new FakeEmbeddingProvider({ dimensions: 16 })
  assert.equal(provider.dimensions, 16)
  assert.equal(provider.embedOne('x').length, 16)
  assert.throws(() => provider.embed('not-an-array'), (error) => error instanceof InvalidInputError)
})

test('EmbeddingProviderRegistry：register 可逆 / list 排序 / get', () => {
  const registry = new EmbeddingProviderRegistry()
  const provider = new FakeEmbeddingProvider({ id: 'test-hash' })
  const disposer = registry.register(provider)
  assert.deepEqual(registry.list().map((p) => p.id), ['test-hash'])
  assert.equal(registry.get('test-hash'), provider)
  assert.equal(registry.resolve('test-hash'), provider)
  disposer()
  assert.equal(registry.get('test-hash'), undefined)
  assert.deepEqual(registry.list(), [])
})

test('EmbeddingProviderRegistry：同 id 重复注册响亮失败', () => {
  const registry = new EmbeddingProviderRegistry()
  registry.register(new FakeEmbeddingProvider())
  assert.throws(() => registry.register(new FakeEmbeddingProvider()), (error) => error instanceof InvalidInputError)
})

test('EmbeddingProviderRegistry：缺失 resolve 响亮失败；非法契约响亮失败', () => {
  const registry = new EmbeddingProviderRegistry()
  assert.throws(() => registry.resolve('nope'), (error) => error instanceof EmbeddingNotFoundError)
  assert.throws(() => registry.register(null), (error) => error instanceof InvalidInputError)
  assert.throws(() => registry.register({ id: 'Bad_Id', name: 'x', description: 'x', dimensions: 8, embed: () => [] }), (error) => error instanceof InvalidInputError)
  assert.throws(() => registry.register({ id: 'ok', name: '', description: 'x', dimensions: 8, embed: () => [] }), (error) => error instanceof InvalidInputError)
  assert.throws(() => registry.register({ id: 'ok', name: 'x', description: '', dimensions: 8, embed: () => [] }), (error) => error instanceof InvalidInputError)
  assert.throws(() => registry.register({ id: 'ok', name: 'x', description: 'x', dimensions: 0, embed: () => [] }), (error) => error instanceof InvalidInputError)
  assert.throws(() => registry.register({ id: 'ok', name: 'x', description: 'x', dimensions: 8 }), (error) => error instanceof InvalidInputError)
})
