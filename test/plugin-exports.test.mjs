import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    effect(fn) {
      return fn()
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
  assert.match(src, /llm-grok\/reuse-cli/)
  assert.match(src, /Authorization URL/)
  assert.doesNotMatch(src, /accessToken|refreshToken|access_token/)
  assert.match(src, /loginPending|setInterval/)
})

test('logout stays logged out even when ~/.grok/auth.json exists until reuse-cli', async () => {
  const { GrokSession } = await import(new URL('../dist/host/index.mjs', import.meta.url).href)
  const { XAI_GROK_CLI_AUTH_SCOPE_KEY } = await import(new URL('../dist/host/constants.mjs', import.meta.url).href)
  const homeDir = join(tmpdir(), `dsh-grok-logout-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await mkdir(join(homeDir, '.grok'), { recursive: true })
  await writeFile(
    join(homeDir, '.grok', 'auth.json'),
    JSON.stringify({
      [XAI_GROK_CLI_AUTH_SCOPE_KEY]: {
        key: 'cli-access',
        refresh_token: 'cli-refresh',
        expires_at: Date.now() + 60 * 60 * 1000,
      },
    }),
  )
  const session = new GrokSession({ homeDir })
  assert.equal(await session.getAccessToken(), null)
  assert.equal((await session.snapshot()).loggedIn, false)
  await session.reuseCli()
  assert.equal(await session.getAccessToken(), 'cli-access')
  assert.equal((await session.snapshot()).loggedIn, true)
  await session.logout()
  assert.equal(await session.getAccessToken(), null)
  assert.equal((await session.snapshot()).loggedIn, false)
  await session.reuseCli()
  assert.equal(await session.getAccessToken(), 'cli-access')
  assert.equal((await session.snapshot()).loggedIn, true)
})
