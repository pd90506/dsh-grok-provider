import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generatePkce, generateOAuthState, parseRedirectUrl } from '../dist/host/pkce.mjs'

test('S256 challenge is base64url without padding', async () => {
  const { verifier, challenge, method } = await generatePkce()
  assert.equal(method, 'S256')
  assert.match(verifier, /^[A-Za-z0-9_-]+$/)
  assert.doesNotMatch(challenge, /=/)
})

test('parseRedirectUrl requires matching state', () => {
  const state = generateOAuthState()
  const code = parseRedirectUrl(`http://127.0.0.1:9/cb?code=abc&state=${state}`, state)
  assert.equal(code.code, 'abc')
  assert.throws(() => parseRedirectUrl(`http://127.0.0.1:9/cb?code=abc&state=nope`, state))
  assert.throws(() => parseRedirectUrl('abc', state))
})
