import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildResponsesBody } from '../dist/host/payload.mjs'

const base = {
  provider: 'grok',
  model: 'grok-4.6',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
}

test('system becomes instructions and stream/store flags are set', () => {
  const body = buildResponsesBody({
    ...base,
    system: 'You are Grok.',
    reasoningEffort: 'high',
  })
  assert.equal(body.model, 'grok-4.6')
  assert.equal(body.stream, true)
  assert.equal(body.store, false)
  assert.equal(body.instructions, 'You are Grok.')
  assert.deepEqual(body.reasoning, { effort: 'high' })
  assert.ok(Array.isArray(body.input))
  assert.equal(body.input[0].role, 'user')
})

test('tools map to Responses function tools', () => {
  const body = buildResponsesBody({
    ...base,
    tools: [
      {
        name: 'lookup',
        description: 'Look up a word',
        parameters: { type: 'object', properties: { q: { type: 'string' } } },
      },
    ],
  })
  assert.deepEqual(body.tools, [
    {
      type: 'function',
      name: 'lookup',
      description: 'Look up a word',
      parameters: { type: 'object', properties: { q: { type: 'string' } } },
    },
  ])
})

test('non-empty stop list throws UNSUPPORTED', () => {
  assert.throws(
    () => buildResponsesBody({ ...base, stop: ['END'] }),
    (err) => err && err.code === 'UNSUPPORTED',
  )
})

test('empty stop list is ignored', () => {
  const body = buildResponsesBody({ ...base, stop: [] })
  assert.equal(body.stream, true)
})

test('assistant text plus multiple tool-call blocks emit all items', () => {
  const body = buildResponsesBody({
    ...base,
    messages: [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'calling tools' },
          { type: 'tool-call', id: 'c1', name: 'lookup', arguments: '{"q":"a"}' },
          { type: 'tool-call', id: 'c2', name: 'other', arguments: { x: 1 } },
        ],
      },
    ],
  })
  assert.deepEqual(body.input, [
    { role: 'assistant', content: 'calling tools' },
    {
      type: 'function_call',
      call_id: 'c1',
      name: 'lookup',
      arguments: '{"q":"a"}',
    },
    {
      type: 'function_call',
      call_id: 'c2',
      name: 'other',
      arguments: '{"x":1}',
    },
  ])
})
