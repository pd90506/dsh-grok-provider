import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { GrokAdapter } from '../dist/host/adapter.mjs'
import { CatalogCache, fallbackCatalog } from '../dist/host/catalog.mjs'
import { PROXY_BASE } from '../dist/host/constants.mjs'

const baseOptions = {
  provider: 'grok',
  model: 'grok-4.6',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
}

async function collect(iterable) {
  const out = []
  for await (const chunk of iterable) out.push(chunk)
  return out
}

function sseResponse(events, { status = 200 } = {}) {
  const body = events
    .map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)
    .join('')
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/event-stream' },
  })
}

test('providerInfo describes grok SuperGrok', () => {
  const adapter = new GrokAdapter({ getAccessToken: async () => 'tok' })
  assert.deepEqual(adapter.providerInfo('grok'), { id: 'grok', name: 'Grok (SuperGrok)' })
})

test('listModels uses fallback when cache is empty and merges grok-4.6 fallback metadata', async () => {
  const cache = new CatalogCache()
  const adapter = new GrokAdapter({ getAccessToken: async () => 'tok', catalog: cache })
  const models = await adapter.listModels('grok')
  assert.equal(models[0].id, 'grok-4.6')
  assert.equal(models[0].provider, 'grok')
  const resolved = await adapter.resolveModel('grok', 'grok-4.6')
  assert.equal(resolved.context.contextWindow, 500000)
  assert.deepEqual(
    resolved.reasoning.efforts.map((e) => e.id),
    ['low', 'medium', 'high', 'xhigh'],
  )
  assert.equal(resolved.reasoning.defaultEffort, 'high')
})

test('listModels prefers cache entries and still merges grok-4.6 fallback fields', async () => {
  const cache = new CatalogCache()
  cache.set(
    [{ id: 'grok-4.6', name: 'Grok 4.6', contextWindow: 0, reasoningEfforts: [], input: ['text'] }],
    Date.now(),
  )
  const adapter = new GrokAdapter({ getAccessToken: async () => 'tok', catalog: cache })
  const models = await adapter.listModels('grok')
  assert.equal(models.length, 1)
  const resolved = await adapter.resolveModel('grok', 'grok-4.6')
  const fb = fallbackCatalog()[0]
  assert.equal(resolved.context.contextWindow, fb.contextWindow)
  assert.ok(resolved.reasoning.efforts.length > 0)
})

test('stream throws AUTH and does not fetch when there is no token', async () => {
  let calls = 0
  const adapter = new GrokAdapter({
    getAccessToken: async () => null,
    fetch: async () => {
      calls += 1
      return new Response('nope')
    },
  })
  await assert.rejects(
    () => collect(adapter.stream(baseOptions)),
    (err) => {
      assert.ok(err instanceof LlmError)
      assert.equal(err.code, 'AUTH')
      return true
    },
  )
  assert.equal(calls, 0)
})

test('HTTP 401 maps to AUTH', async () => {
  const adapter = new GrokAdapter({
    getAccessToken: async () => 'tok',
    fetch: async () => new Response('unauthorized', { status: 401 }),
  })
  await assert.rejects(
    () => collect(adapter.stream(baseOptions)),
    (err) => {
      assert.ok(err instanceof LlmError)
      assert.equal(err.code, 'AUTH')
      assert.equal(err.failure.status, 401)
      return true
    },
  )
})

test('empty completed stream maps to EMPTY_RESPONSE finish', async () => {
  const adapter = new GrokAdapter({
    getAccessToken: async () => 'tok',
    fetch: async () =>
      sseResponse([
        {
          event: 'response.completed',
          data: {
            response: {
              status: 'completed',
              usage: { input_tokens: 1, output_tokens: 0 },
              output: [],
            },
          },
        },
      ]),
  })
  const chunks = await collect(adapter.stream(baseOptions))
  const finish = chunks.at(-1)
  assert.equal(finish.type, 'finish')
  assert.equal(finish.reason.kind, 'error')
  assert.equal(finish.reason.failure.code, 'EMPTY_RESPONSE')
})

test('abort signal maps to ABORTED', async () => {
  const controller = new AbortController()
  const adapter = new GrokAdapter({
    getAccessToken: async () => 'tok',
    fetch: async (_url, init) => {
      controller.abort()
      const err = new Error('aborted')
      err.name = 'AbortError'
      if (init.signal?.aborted) throw err
      throw err
    },
  })
  await assert.rejects(
    () => collect(adapter.stream({ ...baseOptions, signal: controller.signal })),
    (err) => {
      assert.ok(err instanceof LlmError)
      assert.equal(err.code, 'ABORTED')
      return true
    },
  )
})

test('POSTs Responses to cli-chat-proxy with bearer', async () => {
  let url
  let method
  let authorization
  const adapter = new GrokAdapter({
    getAccessToken: async () => 'secret-token',
    fetch: async (input, init) => {
      url = String(input)
      method = init.method
      authorization = new Headers(init.headers).get('authorization')
      return sseResponse([
        { event: 'response.output_text.delta', data: { delta: 'ok' } },
        {
          event: 'response.completed',
          data: {
            response: {
              status: 'completed',
              usage: { input_tokens: 1, output_tokens: 1 },
              output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
            },
          },
        },
      ])
    },
  })
  const chunks = await collect(adapter.stream(baseOptions))
  assert.equal(url, `${PROXY_BASE}/responses`)
  assert.equal(method, 'POST')
  assert.equal(authorization, 'Bearer secret-token')
  assert.ok(chunks.some((c) => c.type === 'text-delta' && c.text === 'ok'))
})
