import assert from 'node:assert/strict'
import { test } from 'node:test'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import {
  CatalogCache,
  fallbackCatalog,
  fetchModelsV2,
  MODELS_V2_URL,
  normalizeModelsV2,
} from '../dist/host/catalog.mjs'
import { PACKAGE_IDENTITY } from '../dist/host/identity.mjs'

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
  const got = cache.get()
  got.push({ id: 'mutated' })
  models.push({ id: 'caller-mutated' })
  assert.equal(cache.get().length, 1)
  assert.equal(cache.isFresh(1_000 + 15 * 60 * 1000 - 1), true)
  assert.equal(cache.isFresh(1_000 + 15 * 60 * 1000), false)
  assert.equal(cache.isFresh(1_000 + 60_000, 30_000), false)
})

test('fetchModelsV2 sends attribution headers, bearer, and redirect error', async () => {
  const expected = attributionHeaders(PACKAGE_IDENTITY)
  let url
  let headers
  let redirect
  const models = await fetchModelsV2({
    accessToken: 'tok',
    fetch: async (input, init) => {
      url = String(input)
      headers = new Headers(init.headers)
      redirect = init.redirect
      return new Response(JSON.stringify({ data: [{ id: 'grok-4.6', name: 'Grok 4.6' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  assert.equal(url, MODELS_V2_URL)
  assert.equal(headers.get('authorization'), 'Bearer tok')
  assert.equal(headers.get('user-agent'), expected['user-agent'])
  assert.equal(redirect, 'error')
  assert.equal(models[0].id, 'grok-4.6')
})
