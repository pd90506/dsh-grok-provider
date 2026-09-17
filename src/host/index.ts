import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'
import Schema from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-llm'
import '@deepseek-ai/dsh-settings'
import '@deepseek-ai/dsh-client-connection'
import { GrokAdapter } from './adapter.ts'
import { CatalogCache, fetchModelsV2, fallbackCatalog } from './catalog.ts'
import { CredentialStore, readGrokCliAuth, type TokenSet } from './credentials.ts'
import {
  PLUGIN_NAME,
  PROVIDER_ROUTE,
  STREAM_IDLE_TIMEOUT_MS,
} from './constants.ts'
import {
  buildAuthorizationUrl,
  exchangeCode,
  pollDevice,
  refreshTokens,
  requestDeviceCode,
} from './oauth.ts'
import { generateOAuthState, generatePkce, parseRedirectUrl } from './pkce.ts'

export const name = PLUGIN_NAME
export const inject = ['llm', 'settings'] as const

export const Config = Schema.object({
  streamIdleTimeoutMs: Schema.number().default(STREAM_IDLE_TIMEOUT_MS),
})

export type Config = {
  streamIdleTimeoutMs: number
}

export type GrokPublicStatus = {
  loggedIn: boolean
  catalogCount: number
  lastError?: string
  deviceUserCode?: string
  deviceVerificationUri?: string
  authorizationUrl?: string
}

type RpcResult = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string; details: object } }

function ok(value: unknown): RpcResult {
  return { ok: true, value }
}

function fail(code: string, message: string): RpcResult {
  return { ok: false, error: { code, message, details: {} } }
}

function openBrowser(url: string): void {
  try {
    if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
    else if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref()
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
  } catch {
    // UI still shows the URL; opening the browser is best-effort.
  }
}

class GrokSession {
  readonly catalog = new CatalogCache()
  readonly store = new CredentialStore()
  lastError: string | undefined
  deviceUserCode: string | undefined
  deviceVerificationUri: string | undefined
  authorizationUrl: string | undefined
  #browser:
    | {
        server: ReturnType<typeof createServer>
        state: string
        verifier: string
        redirectUri: string
      }
    | undefined
  #deviceAbort: AbortController | undefined

  publicStatus(): GrokPublicStatus {
    const status: GrokPublicStatus = {
      loggedIn: false,
      catalogCount: this.catalog.get()?.length ?? fallbackCatalog().length,
    }
    if (this.lastError) status.lastError = this.lastError
    if (this.deviceUserCode) status.deviceUserCode = this.deviceUserCode
    if (this.deviceVerificationUri) status.deviceVerificationUri = this.deviceVerificationUri
    if (this.authorizationUrl) status.authorizationUrl = this.authorizationUrl
    return status
  }

  async loggedIn(): Promise<boolean> {
    return (await this.getAccessToken()) !== null
  }

  async snapshot(): Promise<GrokPublicStatus> {
    const status = this.publicStatus()
    status.loggedIn = await this.loggedIn()
    return status
  }

  async getAccessToken(): Promise<string | null> {
    let tokens = await this.store.read()
    if (!tokens) tokens = await readGrokCliAuth(homedir())
    if (!tokens) return null
    const skew = 60_000
    if (tokens.expiresAt > Date.now() + skew) return tokens.accessToken
    if (tokens.refreshToken) {
      try {
        const next = await refreshTokens({ refreshToken: tokens.refreshToken, fetch })
        await this.store.write(next)
        return next.accessToken
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : 'token refresh failed'
      }
    }
    if (tokens.expiresAt > Date.now()) return tokens.accessToken
    return null
  }

  async persist(tokens: TokenSet): Promise<void> {
    await this.store.write(tokens)
    this.lastError = undefined
    this.deviceUserCode = undefined
    this.deviceVerificationUri = undefined
    this.authorizationUrl = undefined
    await this.refreshCatalog(tokens.accessToken)
  }

  async refreshCatalog(accessToken?: string): Promise<void> {
    const token = accessToken ?? (await this.getAccessToken())
    if (!token) throw new Error('not authenticated')
    const models = await fetchModelsV2({ accessToken: token, fetch })
    this.catalog.set(models.length > 0 ? models : fallbackCatalog(), Date.now())
  }

  stopBrowser(): void {
    if (!this.#browser) return
    this.#browser.server.close()
    this.#browser = undefined
    this.authorizationUrl = undefined
  }

  async startBrowserLogin(): Promise<GrokPublicStatus> {
    this.stopBrowser()
    const pkce = await generatePkce()
    const state = generateOAuthState()
    const server = createServer((req, res) => {
      void this.#handleBrowserRequest(req, res)
    })
    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => resolve())
      server.once('error', reject)
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close()
      throw new Error('failed to bind OAuth loopback listener')
    }
    const redirectUri = `http://127.0.0.1:${address.port}/callback`
    this.#browser = { server, state, verifier: pkce.verifier, redirectUri }
    this.authorizationUrl = buildAuthorizationUrl({
      redirectUri,
      state,
      challenge: pkce.challenge,
    })
    this.lastError = undefined
    openBrowser(this.authorizationUrl)
    return this.snapshot()
  }

  async completeBrowserRedirect(url: string): Promise<GrokPublicStatus> {
    if (!this.#browser) throw new Error('no browser login in progress')
    const { code } = parseRedirectUrl(url, this.#browser.state)
    const tokens = await exchangeCode({
      code,
      verifier: this.#browser.verifier,
      redirectUri: this.#browser.redirectUri,
      fetch,
    })
    this.stopBrowser()
    await this.persist(tokens)
    return this.snapshot()
  }

  async #handleBrowserRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const host = req.headers.host ?? '127.0.0.1'
      const url = new URL(req.url ?? '/', `http://${host}`)
      if (url.pathname !== '/callback') {
        res.writeHead(404)
        res.end()
        return
      }
      await this.completeBrowserRedirect(url.toString())
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('Grok login complete. You can close this tab.')
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : 'browser login failed'
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('Login failed. Return to Settings and try again.')
    }
  }

  async startDeviceLogin(): Promise<GrokPublicStatus> {
    this.#deviceAbort?.abort()
    const started = await requestDeviceCode({ fetch })
    this.deviceUserCode = started.userCode
    this.deviceVerificationUri = started.verificationUri
    this.lastError = undefined
    const abort = new AbortController()
    this.#deviceAbort = abort
    void pollDevice({
      deviceCode: started.deviceCode,
      intervalMs: started.intervalMs,
      fetch,
      signal: abort.signal,
    })
      .then(async (tokens) => {
        if (abort.signal.aborted) return
        await this.persist(tokens)
      })
      .catch((err) => {
        if (abort.signal.aborted) return
        this.lastError = err instanceof Error ? err.message : 'device login failed'
      })
    return this.snapshot()
  }

  async logout(): Promise<GrokPublicStatus> {
    this.#deviceAbort?.abort()
    this.stopBrowser()
    await this.store.clear()
    this.lastError = undefined
    return this.snapshot()
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export function apply(ctx: Context, config: Config) {
  const idleTimeoutMs = config.streamIdleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS
  const session = new GrokSession()
  const adapter = new GrokAdapter({
    catalog: session.catalog,
    idleTimeoutMs,
    getAccessToken: () => session.getAccessToken(),
  })
  ctx.llm.registerAdapter([PROVIDER_ROUTE], adapter)
  ctx.settings.installSection(ctx, PLUGIN_NAME, Config, config, {
    setSource: () => {},
    onChange: () => {},
  })
  ctx.inject(['connection'], (wired) => {
    wired.connection.rpc.intercept(
      '/api',
      (endpoint) => endpoint.startsWith('llm-grok/'),
      async (endpoint, payload) => {
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
      },
    )
  })
}
