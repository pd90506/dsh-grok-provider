import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CatalogCache,
  fallbackCatalog,
  normalizeModelsV2,
} from '../dist/host/catalog.mjs'

test('normalizeModelsV2 returns empty array for empty or invalid json', () => {
  assert.deepEqual(normalizeModelsV2(null), [])
  assert.deepEqual(normalizeModelsV2(undefined), [])
  assert.deepEqual(normalizeModelsV2('nope'), [])
  assert.deepEqual(normalizeModelsV2({}), [])
  assert.deepEqual(normalizeModelsV2({ data: 'x' }), [])
})

test('normalizeModelsV2 drops grok-build-0.1 and invalid ids', () => {
  const models = normalizeModelsV2({
    data: [
      { id: 'grok-4.6', name: 'Grok 4.6' },
      { id: 'grok-build-0.1' },
      { name: 'no id' },
      { id: 12 },
      { id: 'bad id with spaces' },
      { id: 'ok:model_1.2' },
    ],
  })
  assert.deepEqual(
    models.map((m) => m.id),
    ['grok-4.6', 'ok:model_1.2'],
  )
})

test('fallbackCatalog is a single grok-4.6 entry with expected shape', () => {
  const catalog = fallbackCatalog()
  assert.equal(catalog.length, 1)
  const [model] = catalog
  assert.equal(model.id, 'grok-4.6')
  assert.equal(model.contextWindow, 500000)
  assert.deepEqual(model.reasoningEfforts, ['low', 'medium', 'high', 'xhigh'])
  assert.equal(model.defaultEffort, 'high')
  assert.deepEqual(model.input, ['text', 'image'])
  assert.equal(typeof model.name, 'string')
})

test('CatalogCache TTL freshness is true inside window and false after', () => {
  const cache = new CatalogCache()
  assert.equal(cache.get(), undefined)
  assert.equal(cache.isFresh(1_000, 15 * 60 * 1000), false)

  const models = fallbackCatalog()
  cache.set(models, 1_000)
  assert.deepEqual(cache.get(), models)
  assert.equal(cache.isFresh(1_000 + 15 * 60 * 1000 - 1), true)
  assert.equal(cache.isFresh(1_000 + 15 * 60 * 1000), false)
  assert.equal(cache.isFresh(1_000 + 60_000, 30_000), false)
})
