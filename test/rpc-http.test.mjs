import assert from 'node:assert/strict'
import test from 'node:test'
import { dispatchGrokRpc, handleGrokRpcFetch } from '../dist/host/rpc-http.mjs'

test('handleGrokRpcFetch returns RPC envelope for login-device', async () => {
  const session = {
    snapshot: async () => ({ loggedIn: false, catalogCount: 1, loginPending: true, deviceUserCode: 'ABCD' }),
    startDeviceLogin: async () => ({ loggedIn: false, catalogCount: 1, loginPending: true, deviceUserCode: 'ABCD' }),
  }
  const request = new Request('http://127.0.0.1/api/llm-grok/login-device', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'rpc-1',
      method: 'llm-grok/login-device',
      payload: {},
    }),
  })
  const response = await handleGrokRpcFetch(request, 'llm-grok/login-device', (endpoint, payload) =>
    dispatchGrokRpc(session, endpoint, payload),
  )
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.type, 'server-response')
  assert.equal(body.rpcId, 'rpc-1')
  assert.equal(body.result.ok, true)
  assert.equal(body.result.value.deviceUserCode, 'ABCD')
})
