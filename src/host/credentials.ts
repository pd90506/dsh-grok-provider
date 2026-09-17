import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  PLUGIN_AUTH_DIR,
  PLUGIN_AUTH_FILE,
  XAI_GROK_CLI_AUTH_SCOPE_KEY,
  XAI_GROK_CLI_LEGACY_AUTH_SCOPE_KEY,
} from './constants.ts'

export type TokenSet = {
  accessToken: string
  refreshToken?: string
  expiresAt: number
  tokenType: 'Bearer'
}

function parseExpiry(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !value.trim()) return undefined
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return numeric
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function asTokenSet(access: string, refresh: unknown, expiresAt: number): TokenSet {
  const token: TokenSet = {
    accessToken: access,
    expiresAt,
    tokenType: 'Bearer',
  }
  if (typeof refresh === 'string' && refresh) token.refreshToken = refresh
  return token
}

export class CredentialStore {
  readonly homeDir: string
  readonly filePath: string

  constructor(options: { homeDir?: string } = {}) {
    this.homeDir = options.homeDir ?? homedir()
    this.filePath = join(this.homeDir, PLUGIN_AUTH_DIR, PLUGIN_AUTH_FILE)
  }

  async #readRaw(): Promise<Record<string, unknown> | null> {
    try {
      const raw = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
      return raw as Record<string, unknown>
    } catch {
      return null
    }
  }

  async read(): Promise<TokenSet | null> {
    const rec = await this.#readRaw()
    if (!rec) return null
    if (typeof rec.accessToken !== 'string' || !rec.accessToken) return null
    if (typeof rec.expiresAt !== 'number' || !Number.isFinite(rec.expiresAt)) return null
    return asTokenSet(rec.accessToken, rec.refreshToken, rec.expiresAt)
  }

  /** After logout this is true until an explicit plugin login writes tokens again. */
  async skipCli(): Promise<boolean> {
    const rec = await this.#readRaw()
    return rec?.skipCli === true
  }

  async #persist(doc: Record<string, unknown>): Promise<void> {
    const dir = join(this.homeDir, PLUGIN_AUTH_DIR)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await writeFile(this.filePath, `${JSON.stringify(doc, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    if (process.platform !== 'win32') {
      await chmod(dir, 0o700)
      await chmod(this.filePath, 0o600)
    }
  }

  async write(t: TokenSet): Promise<void> {
    await this.#persist({ ...t, skipCli: false })
  }

  async clear(): Promise<void> {
    await this.#persist({ skipCli: true })
  }

  async allowCliReuse(): Promise<void> {
    await this.#persist({ skipCli: false })
  }
}

/** Read-only parse of official Grok CLI `~/.grok/auth.json`. Never writes. */
export async function readGrokCliAuth(homeDir: string): Promise<TokenSet | null> {
  const authPath = join(homeDir, '.grok', 'auth.json')
  let data: unknown
  try {
    data = JSON.parse(await readFile(authPath, 'utf8'))
  } catch {
    return null
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const rec = data as Record<string, unknown>

  const oidc = rec[XAI_GROK_CLI_AUTH_SCOPE_KEY]
  if (oidc && typeof oidc === 'object' && !Array.isArray(oidc)) {
    const row = oidc as Record<string, unknown>
    const access = String(row.key || row.access_token || row.token || '')
    if (access) {
      const expires = parseExpiry(row.expires_at) ?? Date.now() + 6 * 60 * 60 * 1000
      return asTokenSet(access, row.refresh_token || row.refresh, expires)
    }
  }

  const legacy = rec[XAI_GROK_CLI_LEGACY_AUTH_SCOPE_KEY]
  if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
    const row = legacy as Record<string, unknown>
    const access = String(row.key || row.access_token || row.token || '')
    if (access) {
      return asTokenSet(access, row.refresh_token, Date.now() + 30 * 24 * 60 * 60 * 1000)
    }
  }

  const top = rec.access_token || rec.token
  if (typeof top === 'string' && top) {
    const expires = parseExpiry(rec.expires_at || rec.expires) ?? Date.now() + 30 * 24 * 60 * 60 * 1000
    return asTokenSet(top, rec.refresh_token || rec.refresh, expires)
  }

  return null
}
