import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import { GrokAdapter } from '../dist/host/adapter.mjs'

test('stream request User-Agent contains product from attributionHeaders', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const expected = attributionHeaders({
    product: pkg.name,
    version: pkg.version,
    url: pkg.homepage,
  })
  let userAgent
  const adapter = new GrokAdapter({
    getAccessToken: async () => 'tok',
    fetch: async (_url, init) => {
      userAgent = new Headers(init.headers).get('user-agent')
      return new Response(
        'event: response.completed\ndata: {"response":{"status":"completed","usage":{"input_tokens":0,"output_tokens":0},"output":[{"type":"message","content":[{"type":"output_text","text":"x"}]}]}}\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      )
    },
  })
  for await (const _ of adapter.stream({
    provider: 'grok',
    model: 'grok-4.6',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  })) {
    // drain
  }
  assert.equal(typeof userAgent, 'string')
  assert.ok(userAgent.includes(expected['user-agent'].split('/')[0]))
  assert.equal(userAgent, expected['user-agent'])
})
