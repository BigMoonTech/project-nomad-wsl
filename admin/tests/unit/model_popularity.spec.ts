import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareModelsByPopularity, parseModelPulls } from '../../app/utils/model_popularity.js'
import type { NomadOllamaModel } from '../../types/ollama.js'

function model(name: string, pulls: string | null): NomadOllamaModel {
  return {
    id: name,
    name,
    estimated_pulls: pulls,
    description: '',
    model_last_updated: null,
    first_seen: '',
    tags: [],
  }
}

test('missing or invalid popularity stays unknown instead of throwing or inventing counts', () => {
  for (const value of [null, undefined, '', 'N/A', '-1', 'Infinity', {}, 123]) {
    assert.equal(parseModelPulls(value), null)
  }
  assert.equal(parseModelPulls('0'), 0)
})

test('ordinary popularity counts retain their numeric ranking', () => {
  const models = [model('small', '3K'), model('large', '1.2B'), model('medium', '54.7M')]
  assert.deepEqual(
    models.sort(compareModelsByPopularity).map((m) => m.name),
    ['large', 'medium', 'small']
  )
  assert.equal(parseModelPulls(' 1.5 m '), 1_500_000)
  assert.equal(parseModelPulls('123'), 123)
})

test('a catalog with all-null popularity remains complete with deterministic name order', () => {
  const models = Array.from({ length: 252 }, (_, i) =>
    model(`model-${String(251 - i).padStart(3, '0')}`, null)
  )
  models.sort(compareModelsByPopularity)
  assert.equal(models.length, 252)
  assert.equal(models[0].name, 'model-000')
  assert.equal(models[251].name, 'model-251')
  assert.ok(models.every((m) => m.estimated_pulls === null))
})

test('unknown counts sort after known counts, with stable alphabetical ties', () => {
  const models = [
    model('unknown-z', null),
    model('zero', '0'),
    model('b', '2M'),
    model('a', '2M'),
    model('unknown-a', 'N/A'),
  ]
  assert.deepEqual(
    models.sort(compareModelsByPopularity).map((m) => m.name),
    ['a', 'b', 'zero', 'unknown-a', 'unknown-z']
  )
})
