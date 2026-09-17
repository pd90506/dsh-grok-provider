import {
  XAI_OAUTH_AUTHORIZATION_URL,
  XAI_OAUTH_CLIENT_ID,
  XAI_OAUTH_DEVICE_GRANT_TYPE,
  XAI_OAUTH_DEVICE_URL,
  XAI_OAUTH_TOKEN_URL,
} from './constants.ts'
import type { TokenSet } from './credentials.ts'

export {
  XAI_OAUTH_AUTHORIZATION_URL,
  XAI_OAUTH_DEVICE_URL,
  XAI_OAUTH_TOKEN_URL,
}

type FetchLike = typeof fetch

type TokenPayload = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  error?: string
}

function headers(): Record<string, string> {
  return {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'application/json',
    'user-agent': 'dsh-grok-provider',
  }
}

function tokenSetFromPayload(data: TokenPayload, fallbackRefresh?: string): TokenSet {
  if (typeof data.access_token !== 'string' || !data.access_token) {
    throw new Error('xAI token response did not include an access token')
  }
  const refresh =
    typeof data.refresh_token === 'string' && data.refresh_token
      ? data.refresh_token
      : fallbackRefresh
  const expiresIn =
    typeof data.expires_in === 'number' && Number.isFinite(data.expires_in) && data.expires_in > 0
      ? data.expires_in
      : 3600
  const token: TokenSet = {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
    tokenType: 'Bearer',
  }
  if (refresh) token.refreshToken = refresh
  return token
}

async function postToken(fetchImpl: FetchLike, body: Record<string, string>, signal?: AbortSignal): Promise<TokenPayload> {
  const response = await fetchImpl(XAI_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: headers(),
    body: new URLSearchParams(body).toString(),
    redirect: 'error',
    signal,
  })
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('xAI token request returned invalid JSON')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('xAI token request returned invalid JSON')
  }
  return payload as TokenPayload
}

export async function exchangeCode(options: {
  code: string
  verifier: string
  redirectUri: string
  fetch: FetchLike
}): Promise<TokenSet> {
  const data = await postToken(options.fetch, {
    grant_type: 'authorization_code',
    code: options.code,
    redirect_uri: options.redirectUri,
    client_id: XAI_OAUTH_CLIENT_ID,
    code_verifier: options.verifier,
  })
  return tokenSetFromPayload(data)
}

export async function refreshTokens(options: {
  refreshToken: string
  fetch: FetchLike
}): Promise<TokenSet> {
  const data = await postToken(options.fetch, {
    grant_type: 'refresh_token',
    refresh_token: options.refreshToken,
    client_id: XAI_OAUTH_CLIENT_ID,
  })
  return tokenSetFromPayload(data, options.refreshToken)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('aborted'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason ?? new Error('aborted'))
      },
      { once: true },
    )
  })
}

export async function pollDevice(options: {
  deviceCode: string
  intervalMs: number
  fetch: FetchLike
  signal?: AbortSignal
}): Promise<TokenSet> {
  const interval = Math.max(0, options.intervalMs)
  for (;;) {
    if (options.signal?.aborted) throw options.signal.reason ?? new Error('aborted')
    const data = await postToken(
      options.fetch,
      {
        grant_type: XAI_OAUTH_DEVICE_GRANT_TYPE,
        device_code: options.deviceCode,
        client_id: XAI_OAUTH_CLIENT_ID,
      },
      options.signal,
    )
    if (data.error === 'authorization_pending' || data.error === 'slow_down') {
      await sleep(data.error === 'slow_down' ? interval + 5000 : interval, options.signal)
      continue
    }
    if (data.error) throw new Error(data.error)
    return tokenSetFromPayload(data)
  }
}
