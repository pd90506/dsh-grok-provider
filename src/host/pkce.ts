import { createHash, randomBytes } from 'node:crypto'

function base64Url(buf: Buffer): string {
  return buf.toString('base64url')
}

export async function generatePkce(): Promise<{
  verifier: string
  challenge: string
  method: 'S256'
}> {
  const verifier = base64Url(randomBytes(32))
  const challenge = base64Url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge, method: 'S256' }
}

export function generateOAuthState(): string {
  return randomBytes(32).toString('hex')
}

export function parseRedirectUrl(url: string, expectedState: string): { code: string } {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('redirect must be a URL, not a raw authorization code')
  }
  const code = parsed.searchParams.get('code')
  const state = parsed.searchParams.get('state')
  if (!code) throw new Error('missing code')
  if (!state) throw new Error('missing state')
  if (state !== expectedState) throw new Error('state mismatch')
  return { code }
}
