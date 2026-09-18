export type GrokRpcSession = {
  lastError?: string
  snapshot(): Promise<unknown>
  startBrowserLogin(): Promise<unknown>
  startDeviceLogin(): Promise<unknown>
  completeBrowserRedirect(url: string): Promise<unknown>
  logout(): Promise<unknown>
  reuseCli(): Promise<unknown>
  refreshCatalog(): Promise<unknown>
}

export const GROK_RPC_ENDPOINTS = [
  'llm-grok/status',
  'llm-grok/login-browser',
  'llm-grok/login-device',
  'llm-grok/complete-browser',
  'llm-grok/logout',
  'llm-grok/reuse-cli',
  'llm-grok/refresh-catalog',
] as const

export type GrokRpcEndpoint = (typeof GROK_RPC_ENDPOINTS)[number]

export type RpcResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; details: object } }

function ok(value: unknown): RpcResult {
  return { ok: true, value }
}

function fail(code: string, message: string): RpcResult {
  return { ok: false, error: { code, message, details: {} } }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export async function dispatchGrokRpc(
  session: GrokRpcSession,
  endpoint: string,
  payload: unknown,
): Promise<RpcResult> {
  try {
    if (endpoint === 'llm-grok/status') return ok(await session.snapshot())
    if (endpoint === 'llm-grok/login-browser') return ok(await session.startBrowserLogin())
    if (endpoint === 'llm-grok/login-device') return ok(await session.startDeviceLogin())
    if (endpoint === 'llm-grok/complete-browser') {
      const url = asRecord(payload).url
      if (typeof url !== 'string') return fail('INVALID_REQUEST', 'complete-browser requires url')
      return ok(await session.completeBrowserRedirect(url))
    }
    if (endpoint === 'llm-grok/logout') return ok(await session.logout())
    if (endpoint === 'llm-grok/reuse-cli') return ok(await session.reuseCli())
    if (endpoint === 'llm-grok/refresh-catalog') {
      await session.refreshCatalog()
      return ok(await session.snapshot())
    }
    return fail('NOT_FOUND', `unknown endpoint ${endpoint}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'request failed'
    session.lastError = message
    return fail('GROK', message)
  }
}

function jsonResponse(rpcId: string, result: RpcResult): Response {
  return Response.json({
    type: 'server-response',
    rpcId,
    result,
  })
}

export async function handleGrokRpcFetch(
  request: Request,
  endpoint: string,
  dispatch: (endpoint: string, payload: unknown) => Promise<RpcResult>,
): Promise<Response> {
  if (request.method !== 'POST') return new Response('not found', { status: 404 })
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    return new Response('content type must be application/json', { status: 415 })
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response('body is not JSON', { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonResponse('invalid-request', fail('gateway/bad-request', 'invalid client-request message'))
  }
  const envelope = body as Record<string, unknown>
  if (envelope.type !== 'client-request' || typeof envelope.rpcId !== 'string') {
    return jsonResponse(
      typeof envelope.rpcId === 'string' ? envelope.rpcId : 'invalid-request',
      fail('gateway/bad-request', 'invalid client-request message'),
    )
  }
  if (envelope.method !== endpoint) {
    return jsonResponse(
      envelope.rpcId,
      fail(
        'gateway/bad-request',
        `method ${JSON.stringify(envelope.method)} does not match endpoint ${JSON.stringify(endpoint)}`,
      ),
    )
  }
  try {
    const result = await dispatch(endpoint, envelope.payload)
    return jsonResponse(envelope.rpcId, result)
  } catch (error) {
    return new Response(`handler failure: ${String(error)}`, { status: 500 })
  }
}

export function grokRpcPath(endpoint: GrokRpcEndpoint): string {
  return `/api/${endpoint}`
}
