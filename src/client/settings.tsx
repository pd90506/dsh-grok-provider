import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'llm-grok-client'
export const inject = ['slots', 'connection']

type PublicStatus = {
  loggedIn: boolean
  catalogCount: number
  lastError?: string
  deviceUserCode?: string
  deviceVerificationUri?: string
  authorizationUrl?: string
}

type RpcResult = { ok: true; value: PublicStatus } | { ok: false; error: { message: string } }

type Rpc = {
  call: (channel: string, endpoint: string, payload: unknown) => Promise<RpcResult>
}

async function callRpc(rpc: Rpc, endpoint: string, payload: unknown = {}): Promise<PublicStatus> {
  const result = await rpc.call('/api', endpoint, payload)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function GrokSettingsSection(props: { rpc?: Rpc }): ReactNode {
  const rpc = props.rpc
  const [status, setStatus] = useState<PublicStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [redirectUrl, setRedirectUrl] = useState('')
  const [error, setError] = useState<string | undefined>()

  const refresh = useCallback(async () => {
    if (!rpc) return
    const next = await callRpc(rpc, 'llm-grok/status')
    setStatus(next)
    setError(next.lastError)
  }, [rpc])

  useEffect(() => {
    void refresh().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'status failed')
    })
  }, [refresh])

  const run = async (endpoint: string, payload: unknown = {}) => {
    if (!rpc) return
    setBusy(true)
    try {
      const next = await callRpc(rpc, endpoint, payload)
      setStatus(next)
      setError(next.lastError)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request failed')
    } finally {
      setBusy(false)
    }
  }

  if (!rpc) return null

  const loggedIn = status?.loggedIn === true

  return (
    <section>
      <h2>Grok</h2>
      <p>{loggedIn ? 'Logged in with SuperGrok' : 'Logged out'}</p>
      <p>Models in catalog: {status?.catalogCount ?? 0}</p>
      {status?.deviceUserCode ? (
        <p>
          Device code: {status.deviceUserCode}
          {status.deviceVerificationUri ? (
            <>
              {' '}
              — open {status.deviceVerificationUri}
            </>
          ) : null}
        </p>
      ) : null}
      {status?.authorizationUrl ? (
        <p>If the browser did not open, visit the authorization URL shown in your terminal Host logs — this page never displays tokens.</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <p>
        <button type="button" disabled={busy} onClick={() => void run('llm-grok/login-browser')}>
          Login (browser)
        </button>{' '}
        <button type="button" disabled={busy} onClick={() => void run('llm-grok/login-device')}>
          Login (device)
        </button>{' '}
        <button type="button" disabled={busy || !loggedIn} onClick={() => void run('llm-grok/logout')}>
          Logout
        </button>{' '}
        <button type="button" disabled={busy || !loggedIn} onClick={() => void run('llm-grok/refresh-catalog')}>
          Refresh catalog
        </button>
      </p>
      <p>
        <label>
          Paste redirect URL
          <input value={redirectUrl} onChange={(event) => setRedirectUrl(event.target.value)} />
        </label>{' '}
        <button
          type="button"
          disabled={busy || !redirectUrl}
          onClick={() => void run('llm-grok/complete-browser', { url: redirectUrl })}
        >
          Complete browser login
        </button>
      </p>
    </section>
  )
}

export function apply(ctx: Context) {
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'grok',
        order: 25,
        label: () => 'Grok',
        inject: () => ({ rpc: ctx.connection.rpc }),
      },
      GrokSettingsSection,
    ),
  )
}
