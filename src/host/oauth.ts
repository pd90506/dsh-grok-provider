import {
  XAI_OAUTH_AUTHORIZATION_URL,
  XAI_OAUTH_CLIENT_ID,
  XAI_OAUTH_DEVICE_GRANT_TYPE,
  XAI_OAUTH_DEVICE_MAX_DURATION_MS,
  XAI_OAUTH_DEVICE_SLOW_DOWN_MS,
  XAI_OAUTH_DEVICE_URL,
  XAI_OAUTH_SCOPE,
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

function oauthErrorMessage(data: TokenPayload, status: number): string {
  if (typeof data.error === 'string' && data.error) return data.error
  return `xAI token request failed with status ${status}`
}

async function postToken(
  fetchImpl: FetchLike,
  body: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; data: TokenPayload }> {
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
  return { ok: response.ok, status: response.status, data: payload as TokenPayload }
}

function requireTokenSet(
  result: { ok: boolean; status: number; data: TokenPayload },
  fallbackRefresh?: string,
): TokenSet {
  if (!result.ok || result.data.error) {
    throw new Error(oauthErrorMessage(result.data, result.status))
  }
  return tokenSetFromPayload(result.data, fallbackRefresh)
}

export async function exchangeCode(options: {
  code: string
  verifier: string
  redirectUri: string
  fetch: FetchLike
}): Promise<TokenSet> {
  return requireTokenSet(
    await postToken(options.fetch, {
      grant_type: 'authorization_code',
      code: options.code,
      redirect_uri: options.redirectUri,
      client_id: XAI_OAUTH_CLIENT_ID,
      code_verifier: options.verifier,
    }),
  )
}

export async function refreshTokens(options: {
  refreshToken: string
  fetch: FetchLike
}): Promise<TokenSet> {
  return requireTokenSet(
    await postToken(options.fetch, {
      grant_type: 'refresh_token',
      refresh_token: options.refreshToken,
      client_id: XAI_OAUTH_CLIENT_ID,
    }),
    options.refreshToken,
  )
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
  now?: () => number
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}): Promise<TokenSet> {
  const wait = options.sleep ?? sleep
  const now = options.now ?? Date.now
  const started = now()
  let interval = Math.max(0, options.intervalMs)
  for (;;) {
    if (options.signal?.aborted) throw options.signal.reason ?? new Error('aborted')
    if (now() - started >= XAI_OAUTH_DEVICE_MAX_DURATION_MS) {
      throw new Error('xAI device authorization timed out after 15 minutes')
    }
    const result = await postToken(
      options.fetch,
      {
        grant_type: XAI_OAUTH_DEVICE_GRANT_TYPE,
        device_code: options.deviceCode,
        client_id: XAI_OAUTH_CLIENT_ID,
      },
      options.signal,
    )
    const { data } = result
    if (data.error === 'slow_down') {
      interval += XAI_OAUTH_DEVICE_SLOW_DOWN_MS
      await wait(interval, options.signal)
      continue
    }
    if (data.error === 'authorization_pending') {
      await wait(interval, options.signal)
      continue
    }
    if (!result.ok || data.error) {
      throw new Error(oauthErrorMessage(data, result.status))
    }
    return tokenSetFromPayload(data)
  }
}

export function buildAuthorizationUrl(options: {
  redirectUri: string
  state: string
  challenge: string
}): string {
  const url = new URL(XAI_OAUTH_AUTHORIZATION_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', XAI_OAUTH_CLIENT_ID)
  url.searchParams.set('redirect_uri', options.redirectUri)
  url.searchParams.set('state', options.state)
  url.searchParams.set('code_challenge', options.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('scope', XAI_OAUTH_SCOPE)
  return url.toString()
}

export type DeviceAuthorization = {
  deviceCode: string
  userCode: string
  verificationUri: string
  intervalMs: number
}

export async function requestDeviceCode(options: { fetch: FetchLike }): Promise<DeviceAuthorization> {
  const response = await options.fetch(XAI_OAUTH_DEVICE_URL, {
    method: 'POST',
    headers: headers(),
    body: new URLSearchParams({
      client_id: XAI_OAUTH_CLIENT_ID,
      scope: XAI_OAUTH_SCOPE,
    }).toString(),
    redirect: 'error',
  })
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('xAI device request returned invalid JSON')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('xAI device request returned invalid JSON')
  }
  const data = payload as Record<string, unknown>
  if (!response.ok || typeof data.error === 'string') {
    throw new Error(typeof data.error === 'string' ? data.error : `xAI device request failed with status ${response.status}`)
  }
  const deviceCode = data.device_code
  const userCode = data.user_code
  const verificationUri =
    (typeof data.verification_uri_complete === 'string' && data.verification_uri_complete) ||
    (typeof data.verification_uri === 'string' && data.verification_uri) ||
    ''
  if (typeof deviceCode !== 'string' || !deviceCode || typeof userCode !== 'string' || !userCode || !verificationUri) {
    throw new Error('xAI device response was missing user or device codes')
  }
  const interval =
    typeof data.interval === 'number' && Number.isFinite(data.interval) && data.interval > 0 ? data.interval : 5
  return {
    deviceCode,
    userCode,
    verificationUri,
    intervalMs: interval * 1000,
  }
}
