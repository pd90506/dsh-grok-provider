import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('host export name is llm-grok and Config defaults streamIdleTimeoutMs', async () => {
  const mod = await import(new URL('../dist/host/index.mjs', import.meta.url).href)
  assert.equal(mod.name, 'llm-grok')
  assert.deepEqual([...mod.inject], ['llm', 'settings'])
  const parsed = mod.Config({})
  assert.equal(parsed.streamIdleTimeoutMs, 300000)
})

test('apply registers GrokAdapter on grok and installs settings section', async () => {
  const mod = await import(new URL('../dist/host/index.mjs', import.meta.url).href)
  const calls = []
  const ctx = {
    llm: {
      registerAdapter(providers, adapter) {
        calls.push({ providers, adapterName: adapter.constructor.name })
        const handle = () => {}
        handle.replace = () => {}
        return handle
      },
    },
    settings: {
      installSection(_owner, ns, schema, entry) {
        calls.push({ ns, schemaHasIdle: Boolean(schema), entry })
      },
    },
    connection: {
      rpc: {
        intercept(channel, matches, handler) {
          calls.push({ channel, matches: matches('llm-grok/status'), handler: typeof handler })
          return () => {}
        },
      },
    },
    inject(keys, fn) {
      if (keys.every((key) => ctx[key])) fn(ctx)
    },
  }
  mod.apply(ctx, { streamIdleTimeoutMs: 300000 })
  assert.equal(calls[0].providers[0], 'grok')
  assert.equal(calls[0].adapterName, 'GrokAdapter')
  assert.equal(calls[1].ns, 'llm-grok')
  assert.equal(calls[2].channel, '/api')
  assert.equal(calls[2].matches, true)
})

test('client bundle registers Grok settings and never mentions access tokens', async () => {
  const src = await readFile(new URL('../dist/client/client.js', import.meta.url), 'utf8')
  assert.match(src, /settings\.section/)
  assert.match(src, /llm-grok\/login-browser/)
  assert.match(src, /llm-grok\/login-device/)
  assert.match(src, /llm-grok\/logout/)
  assert.match(src, /llm-grok\/refresh-catalog/)
  assert.doesNotMatch(src, /accessToken|refreshToken|access_token/)
})
