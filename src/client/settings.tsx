import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'llm-grok-client'
export const inject = ['slots', 'connection']

const CSS_ID = 'dsh-grok-provider-settings'
const CSS = `
.grok-settings {
  max-width: 720px;
  color: var(--dsw-alias-label-primary);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.grok-settings h2 {
  color: var(--dsw-alias-label-primary);
  margin: 0;
  font-size: 16px;
  font-weight: 500;
  line-height: 24px;
}
.grok-settings .grok-intro,
.grok-settings .grok-meta {
  color: var(--dsw-alias-label-tertiary);
  margin: 0;
  font-size: 14px;
  line-height: 22px;
}
.grok-settings .grok-alert {
  color: var(--dsw-alias-state-error-primary);
  margin: 0;
  font-size: 12px;
  line-height: 18px;
}
.grok-settings .grok-code {
  color: var(--dsw-alias-label-secondary);
  margin: 0;
  font-size: 13px;
  line-height: 20px;
}
.grok-settings .grok-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
}
.grok-settings .grok-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
}
.grok-settings .grok-field-label {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}
.grok-settings input {
  box-sizing: border-box;
  width: 100%;
  height: 36px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: 10px;
  background: var(--dsw-alias-bg-elevated, transparent);
  color: var(--dsw-alias-label-primary);
  padding: 0 12px;
  font: inherit;
  font-size: 14px;
}
.grok-settings .grok-primary,
.grok-settings .grok-secondary {
  box-sizing: border-box;
  height: 36px;
  font: inherit;
  cursor: pointer;
  border: none;
  border-radius: 18px;
  justify-content: center;
  align-items: center;
  padding: 0 14px;
  font-size: 14px;
  line-height: 22px;
  display: inline-flex;
}
.grok-settings .grok-primary {
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
.grok-settings .grok-secondary {
  background: var(--dsw-alias-button-neutral-fill, var(--dsw-alias-bg-l2, transparent));
  color: var(--dsw-alias-label-primary);
  border: 0.5px solid var(--dsw-alias-border-l3);
}
.grok-settings button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.grok-settings .grok-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  margin-right: 8px;
  background: var(--dsw-alias-state-error-primary);
  vertical-align: middle;
}
.grok-settings .grok-status-dot.ok {
  background: var(--dsw-alias-state-success-primary);
}
`

function ensureCss(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(CSS_ID)}]`)) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-grok-provider'
  tag.dataset.pluginCss = CSS_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

type PublicStatus = {
  loggedIn: boolean
  catalogCount: number
  loginPending?: boolean
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
  ensureCss()
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

  const pending = Boolean(status?.loginPending && !status.loggedIn)
  useEffect(() => {
    if (!pending) return
    const timer = setInterval(() => {
      void refresh().catch(() => {})
    }, 1000)
    return () => clearInterval(timer)
  }, [pending, refresh])

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
    <section className="grok-settings">
      <h2>Grok</h2>
      <p className="grok-intro">
        <span className={`grok-status-dot${loggedIn ? ' ok' : ''}`} />
        {loggedIn ? 'Logged in with SuperGrok' : 'Logged out'}
      </p>
      <p className="grok-meta">Models in catalog: {status?.catalogCount ?? 0}</p>
      {status?.deviceUserCode ? (
        <p className="grok-code">
          Device code: {status.deviceUserCode}
          {status.deviceVerificationUri ? ` — open ${status.deviceVerificationUri}` : null}
        </p>
      ) : null}
      {status?.authorizationUrl ? (
        <label className="grok-field">
          <span className="grok-field-label">Authorization URL</span>
          <input readOnly value={status.authorizationUrl} />
        </label>
      ) : null}
      {error ? (
        <p className="grok-alert" role="alert">
          {error}
        </p>
      ) : null}
      <p className="grok-actions">
        <button type="button" className="grok-primary" disabled={busy} onClick={() => void run('llm-grok/login-browser')}>
          Login (browser)
        </button>
        <button type="button" className="grok-secondary" disabled={busy} onClick={() => void run('llm-grok/login-device')}>
          Login (device)
        </button>
        <button type="button" className="grok-secondary" disabled={busy || !loggedIn} onClick={() => void run('llm-grok/logout')}>
          Logout
        </button>
        <button
          type="button"
          className="grok-secondary"
          disabled={busy || !loggedIn}
          onClick={() => void run('llm-grok/refresh-catalog')}
        >
          Refresh catalog
        </button>
        <button
          type="button"
          className="grok-secondary"
          disabled={busy || loggedIn}
          onClick={() => void run('llm-grok/reuse-cli')}
        >
          Use Grok CLI credentials
        </button>
      </p>
      <label className="grok-field">
        <span className="grok-field-label">Paste redirect URL</span>
        <input value={redirectUrl} onChange={(event) => setRedirectUrl(event.target.value)} />
      </label>
      <p className="grok-actions">
        <button
          type="button"
          className="grok-primary"
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
