import assert from 'node:assert/strict'
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { generatePkce } from '../dist/host/pkce.mjs'
import {
  CredentialStore,
  readGrokCliAuth,
} from '../dist/host/credentials.mjs'
import {
  XAI_OAUTH_AUTHORIZATION_URL,
  XAI_OAUTH_DEVICE_URL,
  XAI_OAUTH_TOKEN_URL,
  exchangeCode,
  pollDevice,
  refreshTokens,
} from '../dist/host/oauth.mjs'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function tempHome(prefix) {
  const homeDir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await mkdir(homeDir, { recursive: true })
  return homeDir
}

test('exchangeCode posts authorization_code and returns access+refresh TokenSet', async () => {
  const { verifier } = await generatePkce()
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return jsonResponse({
      access_token: 'acc-1',
      refresh_token: 'ref-1',
      expires_in: 3600,
      token_type: 'Bearer',
    })
  }
  const tokens = await exchangeCode({
    code: 'auth-code',
    verifier,
    redirectUri: 'http://127.0.0.1:9/callback',
    fetch: fetchImpl,
  })
  assert.equal(tokens.accessToken, 'acc-1')
  assert.equal(tokens.refreshToken, 'ref-1')
  assert.equal(tokens.tokenType, 'Bearer')
  assert.ok(tokens.expiresAt > Date.now())
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, XAI_OAUTH_TOKEN_URL)
  assert.equal(calls[0].init.method, 'POST')
  const body = String(calls[0].init.body)
  assert.match(body, /grant_type=authorization_code/)
  assert.match(body, /code=auth-code/)
  assert.match(body, /code_verifier=/)
  assert.match(body, /redirect_uri=/)
})

test('CredentialStore write then read round-trips TokenSet under homeDir', async () => {
  const homeDir = await tempHome('dsh-grok-cred')
  const store = new CredentialStore({ homeDir })
  const tokenSet = {
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 60_000,
    tokenType: 'Bearer',
  }
  await store.write(tokenSet)
  const read = await store.read()
  assert.deepEqual(read, tokenSet)
  await store.clear()
  assert.equal(await store.read(), null)
})

test('credential file is not world-readable', { skip: process.platform === 'win32' }, async () => {
  const homeDir = await tempHome('dsh-grok-mode')
  const store = new CredentialStore({ homeDir })
  await store.write({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: 1,
    tokenType: 'Bearer',
  })
  const path = join(homeDir, '.dsh-grok-provider', 'auth.json')
  const mode = (await stat(path)).mode & 0o777
  assert.equal(mode, 0o600)
})

test('refreshTokens posts refresh_token grant', async () => {
  const fetchImpl = async (url, init) => {
    assert.equal(url, XAI_OAUTH_TOKEN_URL)
    assert.equal(init.method, 'POST')
    const body = String(init.body)
    assert.match(body, /grant_type=refresh_token/)
    assert.match(body, /refresh_token=old-refresh/)
    return jsonResponse({
      access_token: 'acc-2',
      refresh_token: 'ref-2',
      expires_in: 120,
      token_type: 'Bearer',
    })
  }
  const tokens = await refreshTokens({ refreshToken: 'old-refresh', fetch: fetchImpl })
  assert.equal(tokens.accessToken, 'acc-2')
  assert.equal(tokens.refreshToken, 'ref-2')
})

test('pollDevice waits through authorization_pending then succeeds', async () => {
  let n = 0
  const fetchImpl = async () => {
    n += 1
    if (n === 1) {
      return jsonResponse({ error: 'authorization_pending' }, 400)
    }
    return jsonResponse({
      access_token: 'acc-d',
      refresh_token: 'ref-d',
      expires_in: 60,
      token_type: 'Bearer',
    })
  }
  const tokens = await pollDevice({
    deviceCode: 'dev-1',
    intervalMs: 1,
    fetch: fetchImpl,
  })
  assert.equal(tokens.accessToken, 'acc-d')
  assert.equal(n, 2)
})

test('readGrokCliAuth is read-only and never writes ~/.grok/auth.json', async () => {
  const homeDir = await tempHome('dsh-grok-cli')
  const grokDir = join(homeDir, '.grok')
  await mkdir(grokDir, { recursive: true })
  const authPath = join(grokDir, 'auth.json')
  const original = JSON.stringify({
    'https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828': {
      key: 'cli-access',
      refresh_token: 'cli-refresh',
      expires_at: Date.now() + 3_600_000,
    },
  })
  await writeFile(authPath, original, 'utf8')
  await chmod(authPath, 0o600)
  const before = await stat(authPath)
  const tokens = await readGrokCliAuth(homeDir)
  assert.equal(tokens.accessToken, 'cli-access')
  assert.equal(tokens.refreshToken, 'cli-refresh')
  assert.equal(tokens.tokenType, 'Bearer')
  const after = await stat(authPath)
  assert.equal(after.mtimeMs, before.mtimeMs)
  assert.equal(after.size, before.size)
  assert.equal(await readFile(authPath, 'utf8'), original)
})

test('pinned OAuth URLs are first-party xAI endpoints', () => {
  assert.equal(XAI_OAUTH_AUTHORIZATION_URL, 'https://auth.x.ai/oauth2/authorize')
  assert.equal(XAI_OAUTH_TOKEN_URL, 'https://auth.x.ai/oauth2/token')
  assert.equal(XAI_OAUTH_DEVICE_URL, 'https://auth.x.ai/oauth2/device/code')
})
