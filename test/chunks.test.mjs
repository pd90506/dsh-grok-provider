import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createMapperState,
  finishReasonFrom,
  incompleteStreamFinish,
  mapSseEvent,
} from '../dist/host/chunks.mjs'

test('text delta sequence emits block-start then text-delta; usage before finish', () => {
  const ctx = createMapperState()
  const startAndDelta = mapSseEvent(
    { event: 'response.output_text.delta', data: { delta: 'Hi' } },
    ctx,
  )
  assert.deepEqual(startAndDelta[0], { type: 'block-start', index: 0, blockType: 'text' })
  assert.deepEqual(startAndDelta[1], { type: 'text-delta', index: 0, text: 'Hi' })

  const more = mapSseEvent(
    { event: 'response.output_text.delta', data: { delta: '!' } },
    ctx,
  )
  assert.deepEqual(more, [{ type: 'text-delta', index: 0, text: '!' }])

  const done = mapSseEvent(
    {
      event: 'response.completed',
      data: {
        response: {
          status: 'completed',
          usage: { input_tokens: 3, output_tokens: 2 },
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hi!' }] }],
        },
      },
    },
    ctx,
  )
  const types = done.map((c) => c.type)
  assert.ok(types.includes('block-end'))
  const usageIdx = types.indexOf('usage')
  const finishIdx = types.indexOf('finish')
  assert.ok(usageIdx >= 0 && finishIdx === usageIdx + 1)
  assert.deepEqual(done[usageIdx].usage, { inputTokens: 3, outputTokens: 2 })
  assert.equal(done[finishIdx].reason.kind, 'stop')
})

test('tool-call argument fragments stay strings', () => {
  const ctx = createMapperState()
  const added = mapSseEvent(
    {
      event: 'response.output_item.added',
      data: { item: { type: 'function_call', id: 'call_1', name: 'lookup' } },
    },
    ctx,
  )
  assert.deepEqual(added[0], { type: 'block-start', index: 0, blockType: 'tool-call' })

  const d1 = mapSseEvent(
    { event: 'response.function_call_arguments.delta', data: { delta: '{"q":' } },
    ctx,
  )
  assert.equal(d1[0].type, 'tool-call-delta')
  assert.equal(typeof d1[0].argumentsDelta, 'string')
  assert.equal(d1[0].argumentsDelta, '{"q":')
  assert.equal(d1[0].id, 'call_1')

  const d2 = mapSseEvent(
    { event: 'response.function_call_arguments.delta', data: { delta: '"x"}' } },
    ctx,
  )
  assert.equal(d2[0].argumentsDelta, '"x"}')
})

test('never emit after finish', () => {
  const ctx = createMapperState()
  mapSseEvent({ event: 'response.output_text.delta', data: { delta: 'a' } }, ctx)
  mapSseEvent(
    {
      event: 'response.completed',
      data: {
        response: {
          status: 'completed',
          usage: { input_tokens: 1, output_tokens: 1 },
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'a' }] }],
        },
      },
    },
    ctx,
  )
  const after = mapSseEvent(
    { event: 'response.output_text.delta', data: { delta: 'late' } },
    ctx,
  )
  assert.deepEqual(after, [])
})

test('finishReasonFrom maps empty stop output to empty', () => {
  assert.equal(finishReasonFrom({ status: 'completed', output: [] }), 'empty')
  assert.equal(
    finishReasonFrom({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
    }),
    'stop',
  )
  assert.equal(finishReasonFrom({ status: 'failed' }), 'error')
  assert.equal(finishReasonFrom({ status: 'cancelled' }), 'aborted')
})

test('object function_call_arguments.delta is JSON.stringified', () => {
  const ctx = createMapperState()
  mapSseEvent(
    {
      event: 'response.output_item.added',
      data: { item: { type: 'function_call', id: 'call_1', name: 'lookup' } },
    },
    ctx,
  )
  const chunks = mapSseEvent(
    { event: 'response.function_call_arguments.delta', data: { delta: { q: 'x' } } },
    ctx,
  )
  assert.equal(chunks[0].type, 'tool-call-delta')
  assert.equal(chunks[0].argumentsDelta, '{"q":"x"}')
})

test('empty completed stream emits usage then EMPTY_RESPONSE finish', () => {
  const ctx = createMapperState()
  const done = mapSseEvent(
    {
      event: 'response.completed',
      data: {
        response: {
          status: 'completed',
          usage: { input_tokens: 4, output_tokens: 0 },
          output: [],
        },
      },
    },
    ctx,
  )
  assert.equal(done.length, 2)
  assert.equal(done[0].type, 'usage')
  assert.deepEqual(done[0].usage, { inputTokens: 4, outputTokens: 0 })
  assert.equal(done[1].type, 'finish')
  assert.equal(done[1].reason.kind, 'error')
  assert.equal(done[1].reason.failure.code, 'EMPTY_RESPONSE')
})

test('function_call stream completes as tool-calls with usage before finish', () => {
  const ctx = createMapperState()
  mapSseEvent(
    {
      event: 'response.output_item.added',
      data: { item: { type: 'function_call', id: 'call_1', name: 'lookup' } },
    },
    ctx,
  )
  mapSseEvent(
    { event: 'response.function_call_arguments.delta', data: { delta: '{"q":"a"}' } },
    ctx,
  )
  const done = mapSseEvent(
    {
      event: 'response.completed',
      data: {
        response: {
          status: 'completed',
          usage: { input_tokens: 2, output_tokens: 8 },
          output: [{ type: 'function_call', id: 'call_1', name: 'lookup', arguments: '{"q":"a"}' }],
        },
      },
    },
    ctx,
  )
  const types = done.map((c) => c.type)
  const usageIdx = types.indexOf('usage')
  const finishIdx = types.indexOf('finish')
  assert.ok(types.includes('block-end'))
  assert.ok(usageIdx >= 0 && finishIdx === usageIdx + 1)
  assert.equal(done[finishIdx].reason.kind, 'tool-calls')
})

test('incompleteStreamFinish closes open blocks and emits usage then error finish', () => {
  const ctx = createMapperState()
  mapSseEvent({ event: 'response.output_text.delta', data: { delta: 'partial' } }, ctx)
  const chunks = incompleteStreamFinish(ctx)
  assert.equal(chunks[0].type, 'block-end')
  const usageIdx = chunks.findIndex((c) => c.type === 'usage')
  const finishIdx = chunks.findIndex((c) => c.type === 'finish')
  assert.ok(usageIdx >= 0 && finishIdx === usageIdx + 1)
  assert.equal(chunks[usageIdx].usage.inputTokens, 0)
  assert.equal(chunks[usageIdx].usage.outputTokens, 0)
  assert.equal(chunks[finishIdx].reason.kind, 'error')
  assert.equal(ctx.finished, true)
})

test('completed finish includes smallest replayState when encrypted_content is present', () => {
  const ctx = createMapperState()
  mapSseEvent({ event: 'response.output_text.delta', data: { delta: 'ok' } }, ctx)
  const done = mapSseEvent(
    {
      event: 'response.completed',
      data: {
        response: {
          status: 'completed',
          usage: { input_tokens: 1, output_tokens: 1 },
          output: [
            { type: 'message', content: [{ type: 'output_text', text: 'ok' }] },
            { type: 'reasoning', encrypted_content: 'enc-blob' },
          ],
        },
      },
    },
    ctx,
  )
  const finish = done.find((c) => c.type === 'finish')
  assert.deepEqual(finish.replayState, { encrypted_content: 'enc-blob' })
})

test('failed context-window response maps to CONTEXT_WINDOW_EXCEEDED', () => {
  const ctx = createMapperState()
  const done = mapSseEvent(
    {
      event: 'response.failed',
      data: {
        response: {
          status: 'failed',
          error: { message: 'input is too long for the model context window' },
          usage: { input_tokens: 9, output_tokens: 0 },
        },
      },
    },
    ctx,
  )
  const finish = done.find((c) => c.type === 'finish')
  assert.equal(finish.reason.failure.code, 'CONTEXT_WINDOW_EXCEEDED')
})
