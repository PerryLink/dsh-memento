import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeText, similarity, analyzeCuration } from '../lib/curator.mjs'

const DAY = 86400000
const NOW = 1_700_000_000_000

/** @param {Partial<{id: string, track: string, scope: string, agentKey: string, text: string, recallCount: number, updatedAt: number, lastRecalled: number | null}>} over */
function entry(over = {}) {
  return {
    id: over.id ?? 'e1',
    track: over.track ?? 'user',
    scope: over.scope ?? 'user-global',
    ...(over.agentKey === undefined ? {} : { agentKey: over.agentKey }),
    text: over.text ?? 'hello',
    recallCount: over.recallCount ?? 0,
    updatedAt: over.updatedAt ?? NOW,
    lastRecalled: over.lastRecalled === undefined ? null : over.lastRecalled,
  }
}

test('normalizeText folds whitespace, case and unicode width', () => {
  assert.equal(normalizeText('  Hello   WORLD '), 'hello world')
  assert.equal(normalizeText('ＡＢＣ'), 'abc')
})

test('similarity: identical is 1, unrelated is low', () => {
  assert.equal(similarity('dark mode', 'dark mode'), 1)
  assert.ok(similarity('prefers dark mode.', 'prefers dark mode') > 0.9)
  assert.ok(similarity('alpha beta', 'completely different') < 0.2)
})

test('exact duplicate entries form a merge action flagged manual (ambiguous substring)', () => {
  const plan = analyzeCuration([
    entry({ id: 'a', text: 'same text' }),
    entry({ id: 'b', text: 'same text' }),
  ], { now: NOW })
  assert.equal(plan.counts.mergeDuplicates, 1)
  const action = plan.actions[0]
  assert.equal(action.type, 'merge-duplicates')
  assert.equal(action.exactDuplicate, true)
  assert.equal(action.applyable, false)
  assert.equal(action.matches.length, 1) // deduped set
  assert.equal(action.removedCount, 1)
})

test('near-duplicate distinct texts form a supersede action keeping the higher-value entry', () => {
  const plan = analyzeCuration([
    entry({ id: 'a', text: 'prefers dark mode', recallCount: 0, updatedAt: NOW - DAY }),
    entry({ id: 'b', text: 'prefers dark mode.', recallCount: 3, updatedAt: NOW }),
  ], { now: NOW })
  assert.equal(plan.counts.supersede, 1)
  const action = plan.actions[0]
  assert.equal(action.type, 'supersede')
  assert.equal(action.conflict, true)
  assert.equal(action.keep, 'prefers dark mode.') // higher recallCount wins
  assert.equal(action.applyable, true)
})

test('stale low-value entry yields a decay action', () => {
  const plan = analyzeCuration([
    entry({ id: 'a', text: 'old forgotten note', recallCount: 0, updatedAt: NOW - 100 * DAY }),
  ], { now: NOW })
  assert.equal(plan.counts.decay, 1)
  const action = plan.actions[0]
  assert.equal(action.type, 'decay')
  assert.equal(action.staleDays, 100)
  assert.equal(action.applyable, true)
})

test('fresh or recalled entries are not flagged as stale', () => {
  const plan = analyzeCuration([
    entry({ id: 'a', text: 'fresh', recallCount: 0, updatedAt: NOW - DAY }),
    entry({ id: 'b', text: 'old but recalled', recallCount: 5, updatedAt: NOW - 200 * DAY, lastRecalled: NOW - 200 * DAY }),
  ], { now: NOW })
  assert.equal(plan.counts.decay, 0)
})

test('budget pressure produces a budget action picking lowest-value entries', () => {
  const plan = analyzeCuration([
    entry({ id: 'a', text: 'aaaaaa', recallCount: 0, updatedAt: NOW - DAY }),
    entry({ id: 'b', text: 'bbbbbb', recallCount: 2, updatedAt: NOW }),
  ], { now: NOW, limits: { user: { 'user-global': 10, workspace: 10 }, agent: { 'user-global': 4000, workspace: 4000 } } })
  assert.equal(plan.counts.budget, 1)
  const action = plan.actions.find((item) => item.type === 'budget')
  assert.equal(action.used, 12)
  assert.equal(action.limit, 10)
  assert.equal(action.picks[0].match, 'aaaaaa') // lower value (never recalled) picked first
})

test('empty plan when nothing to curate', () => {
  const plan = analyzeCuration([entry({ id: 'a', text: 'single fresh entry', recallCount: 1, updatedAt: NOW })], { now: NOW })
  assert.equal(plan.actions.length, 0)
  assert.deepEqual(plan.counts, { mergeDuplicates: 0, supersede: 0, decay: 0, budget: 0, manual: 0 })
})
