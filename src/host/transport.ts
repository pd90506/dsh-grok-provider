import { attributionHeaders, LlmError } from '@deepseek-ai/dsh-llm'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMapperState, mapSseEvent } from './chunks.ts'
import { PROXY_BASE, STREAM_IDLE_TIMEOUT_MS } from './constants.ts'
import { buildResponsesBody, type GenerateOptionsLike } from './payload.ts'

export type FetchLike = typeof fetch

export type PackageIdentity = {
  product: string
  version: string
  url: string
}

function loadIdentity(): PackageIdentity {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '../../package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    name: string
    version: string
    homepage?: string
  }
  return {
    product: pkg.name,
    version: pkg.version,
    url: pkg.homepage ?? 'https://github.com/pd90506/dsh-grok-provider',
  }
}

export const PACKAGE_IDENTITY = loadIdentity()

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const rec = err as { name?: string; code?: string }
  return rec.name === 'AbortError' || rec.code === 'ABORT_ERR'
}

export function parseSseBlock(block: string): { event?: string; data: unknown } | undefined {
  const lines = block.split(/\r?\n/)
  let event: string | undefined
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
  }
  if (dataLines.length === 0 && !event) return undefined
  const raw = dataLines.join('\n')
  let data: unknown = raw
  if (raw) {
    try {
      data = JSON.parse(raw)
    } catch {
      data = raw
    }
  }
  return { event, data }
}

async function* iterateSse(
  body: ReadableStream<Uint8Array> | null,
  signal: AbortSignal | undefined,
  idleMs: number,
): AsyncGenerator<{ event?: string; data: unknown }> {
  if (!body) return
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      if (signal?.aborted) {
        throw new LlmError('aborted', 'ABORTED')
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      const idle = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new LlmError('stream idle timeout', 'TIMEOUT'))
        }, idleMs)
      })
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await Promise.race([reader.read(), idle])
      } finally {
        if (timer) clearTimeout(timer)
      }
      if (chunk.done) {
        if (buffer.trim()) {
          const parsed = parseSseBlock(buffer)
          if (parsed) yield parsed
        }
        return
      }
      buffer += decoder.decode(chunk.value, { stream: true })
      const parts = buffer.split(/\r?\n\r?\n/)
      buffer = parts.pop() ?? ''
      for (const part of parts) {
        const parsed = parseSseBlock(part)
        if (parsed) yield parsed
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export async function* streamResponses(options: {
  fetch: FetchLike
  accessToken: string
  generate: GenerateOptionsLike & { signal?: AbortSignal }
  idleTimeoutMs?: number
  identity?: PackageIdentity
}): AsyncGenerator<unknown> {
  const idleTimeoutMs = options.idleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS
  const identity = options.identity ?? PACKAGE_IDENTITY
  const headers = {
    ...attributionHeaders(identity),
    authorization: `Bearer ${options.accessToken}`,
    'content-type': 'application/json',
    accept: 'text/event-stream',
  }
  let response: Response
  try {
    response = await options.fetch(`${PROXY_BASE}/responses`, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildResponsesBody(options.generate)),
      signal: options.generate.signal,
    })
  } catch (err) {
    if (isAbortError(err) || options.generate.signal?.aborted) {
      throw new LlmError('aborted', 'ABORTED', { cause: err })
    }
    throw new LlmError(err instanceof Error ? err.message : 'transport error', 'ERROR', { cause: err })
  }

  if (response.status === 401) {
    throw new LlmError('unauthorized', 'AUTH', { status: 401 })
  }
  if (!response.ok) {
    throw new LlmError(`provider HTTP ${response.status}`, 'ERROR', { status: response.status })
  }

  const ctx = createMapperState()
  try {
    for await (const event of iterateSse(response.body, options.generate.signal, idleTimeoutMs)) {
      const chunks = mapSseEvent(event, ctx)
      for (const chunk of chunks) yield chunk
    }
  } catch (err) {
    if (err instanceof LlmError) throw err
    if (isAbortError(err) || options.generate.signal?.aborted) {
      throw new LlmError('aborted', 'ABORTED', { cause: err })
    }
    throw new LlmError(err instanceof Error ? err.message : 'stream error', 'ERROR', { cause: err })
  }
}
