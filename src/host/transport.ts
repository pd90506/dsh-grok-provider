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

function emptyFinish() {
  return {
    type: 'finish' as const,
    reason: {
      kind: 'error' as const,
      failure: { message: 'empty response', code: 'EMPTY_RESPONSE' },
    },
  }
}

function classifyAbort(request: AbortController, caller?: AbortSignal): never {
  if (caller?.aborted) {
    throw new LlmError('aborted', 'ABORTED')
  }
  throw new LlmError('stream idle timeout', 'TIMEOUT')
}

async function* iterateSse(
  body: ReadableStream<Uint8Array>,
  request: AbortController,
  caller: AbortSignal | undefined,
  armIdle: () => void,
): AsyncGenerator<{ event?: string; data: unknown }> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      if (caller?.aborted) throw new LlmError('aborted', 'ABORTED')
      if (request.signal.aborted) classifyAbort(request, caller)
      armIdle()
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch (err) {
        if (isAbortError(err) || request.signal.aborted || caller?.aborted) {
          classifyAbort(request, caller)
        }
        throw err
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
  const caller = options.generate.signal
  const request = new AbortController()
  const onCallerAbort = () => {
    request.abort()
  }
  caller?.addEventListener('abort', onCallerAbort, { once: true })
  if (caller?.aborted) request.abort()

  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const clearIdle = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = undefined
  }
  const armIdle = () => {
    clearIdle()
    idleTimer = setTimeout(() => {
      request.abort()
    }, idleTimeoutMs)
  }

  const headers = {
    ...attributionHeaders(identity),
    authorization: `Bearer ${options.accessToken}`,
    'content-type': 'application/json',
    accept: 'text/event-stream',
  }

  let response: Response
  armIdle()
  try {
    try {
      response = await options.fetch(`${PROXY_BASE}/responses`, {
        method: 'POST',
        headers,
        body: JSON.stringify(buildResponsesBody(options.generate)),
        signal: request.signal,
      })
    } catch (err) {
      if (isAbortError(err) || request.signal.aborted || caller?.aborted) {
        classifyAbort(request, caller)
      }
      throw new LlmError(err instanceof Error ? err.message : 'transport error', 'ERROR', { cause: err })
    }

    if (response.status === 401) {
      throw new LlmError('unauthorized', 'AUTH', { status: 401 })
    }
    if (!response.ok) {
      throw new LlmError(`provider HTTP ${response.status}`, 'ERROR', { status: response.status })
    }
    if (response.body == null) {
      yield emptyFinish()
      return
    }

    const ctx = createMapperState()
    let emitted = false
    try {
      for await (const event of iterateSse(response.body, request, caller, armIdle)) {
        const chunks = mapSseEvent(event, ctx)
        for (const chunk of chunks) {
          emitted = true
          yield chunk
        }
      }
    } catch (err) {
      if (err instanceof LlmError) throw err
      if (isAbortError(err) || request.signal.aborted || caller?.aborted) {
        classifyAbort(request, caller)
      }
      throw new LlmError(err instanceof Error ? err.message : 'stream error', 'ERROR', { cause: err })
    }
    if (!emitted && !ctx.finished) {
      yield emptyFinish()
    }
  } finally {
    clearIdle()
    caller?.removeEventListener('abort', onCallerAbort)
  }
}
