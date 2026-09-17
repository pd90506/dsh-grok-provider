import { isContextWindowExceededError } from '@deepseek-ai/dsh-llm'

export type MapperState = {
  finished: boolean
  nextIndex: number
  textIndex: number | undefined
  reasoningIndex: number | undefined
  toolIndex: number | undefined
  toolId: string | undefined
  toolName: string | undefined
  text: string
  reasoning: string
  toolArguments: string
  replayState: unknown
}

export function createMapperState(): MapperState {
  return {
    finished: false,
    nextIndex: 0,
    textIndex: undefined,
    reasoningIndex: undefined,
    toolIndex: undefined,
    toolId: undefined,
    toolName: undefined,
    text: '',
    reasoning: '',
    toolArguments: '',
    replayState: undefined,
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function outputHasVisibleContent(output: unknown): boolean {
  if (!Array.isArray(output) || output.length === 0) return false
  for (const item of output) {
    const rec = asRecord(item)
    if (!rec) continue
    if (rec.type === 'function_call') return true
    const content = rec.content
    if (typeof rec.text === 'string' && rec.text.length > 0) return true
    if (Array.isArray(content)) {
      for (const part of content) {
        const p = asRecord(part)
        if (!p) continue
        if (typeof p.text === 'string' && p.text.length > 0) return true
      }
    }
  }
  return false
}

export function finishReasonFrom(response: unknown): 'empty' | 'stop' | 'error' | 'aborted' {
  const rec = asRecord(response) ?? {}
  const status = rec.status
  if (status === 'failed' || status === 'incomplete') return 'error'
  if (status === 'cancelled' || status === 'canceled') return 'aborted'
  if (!outputHasVisibleContent(rec.output)) return 'empty'
  return 'stop'
}

function usageFrom(raw: unknown): { inputTokens: number; outputTokens: number } {
  const rec = asRecord(raw) ?? {}
  const input =
    typeof rec.input_tokens === 'number'
      ? rec.input_tokens
      : typeof rec.inputTokens === 'number'
        ? rec.inputTokens
        : 0
  const output =
    typeof rec.output_tokens === 'number'
      ? rec.output_tokens
      : typeof rec.outputTokens === 'number'
        ? rec.outputTokens
        : 0
  return { inputTokens: input, outputTokens: output }
}

function extractEncryptedContent(source: unknown): string | undefined {
  const rec = asRecord(source)
  if (!rec) return undefined
  if (typeof rec.encrypted_content === 'string' && rec.encrypted_content) return rec.encrypted_content
  const output = rec.output
  if (Array.isArray(output)) {
    for (const item of output) {
      const found = extractEncryptedContent(item)
      if (found) return found
    }
  }
  const content = rec.content
  if (Array.isArray(content)) {
    for (const item of content) {
      const found = extractEncryptedContent(item)
      if (found) return found
    }
  }
  return undefined
}

function rememberReplay(ctx: MapperState, source: unknown): void {
  if (ctx.replayState) return
  const encrypted = extractEncryptedContent(source)
  if (encrypted) ctx.replayState = { encrypted_content: encrypted }
}

function providerErrorDetail(response: unknown): string {
  const rec = asRecord(response) ?? {}
  const err = asRecord(rec.error)
  const parts = [rec.message, rec.code, rec.status, err?.message, err?.code, err?.type]
  return parts.filter((p) => typeof p === 'string' || typeof p === 'number').join(' ')
}

function closeOpenBlocks(ctx: MapperState): unknown[] {
  const out: unknown[] = []
  if (ctx.reasoningIndex !== undefined) {
    out.push({
      type: 'block-end',
      index: ctx.reasoningIndex,
      block: { type: 'reasoning', text: ctx.reasoning },
    })
    ctx.reasoningIndex = undefined
  }
  if (ctx.textIndex !== undefined) {
    out.push({
      type: 'block-end',
      index: ctx.textIndex,
      block: { type: 'text', text: ctx.text },
    })
    ctx.textIndex = undefined
  }
  if (ctx.toolIndex !== undefined) {
    out.push({
      type: 'block-end',
      index: ctx.toolIndex,
      block: {
        type: 'tool-call',
        id: ctx.toolId ?? '',
        name: ctx.toolName ?? '',
        arguments: ctx.toolArguments,
      },
    })
    ctx.toolIndex = undefined
  }
  return out
}

function finishKind(tag: ReturnType<typeof finishReasonFrom>, ctx: MapperState, response?: unknown) {
  if (tag === 'empty') {
    return {
      kind: 'error' as const,
      failure: { message: 'empty response', code: 'EMPTY_RESPONSE' },
    }
  }
  if (tag === 'error') {
    const detail = providerErrorDetail(response)
    if (isContextWindowExceededError(detail)) {
      return {
        kind: 'error' as const,
        failure: { message: 'context window exceeded', code: 'CONTEXT_WINDOW_EXCEEDED' },
      }
    }
    return { kind: 'error' as const, failure: { message: 'provider error', code: 'ERROR' } }
  }
  if (tag === 'aborted') {
    return { kind: 'aborted' as const, failure: { message: 'aborted', code: 'ABORTED' } }
  }
  if (ctx.toolIndex !== undefined || ctx.toolId) {
    return { kind: 'tool-calls' as const }
  }
  return { kind: 'stop' as const }
}

export function incompleteStreamFinish(ctx: MapperState): unknown[] {
  if (ctx.finished) return []
  const out = closeOpenBlocks(ctx)
  out.push({ type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } })
  out.push({
    type: 'finish',
    reason: {
      kind: 'error' as const,
      failure: { message: 'stream ended without finish', code: 'ERROR' },
    },
  })
  ctx.finished = true
  return out
}

export function mapSseEvent(
  event: { event?: string; data: unknown },
  ctx: MapperState,
): unknown[] {
  if (ctx.finished) return []
  const name = event.event ?? ''
  const data = asRecord(event.data) ?? {}

  if (name === 'response.output_item.added') {
    const item = asRecord(data.item) ?? data
    if (item.type === 'function_call') {
      ctx.toolId = typeof item.id === 'string' ? item.id : typeof item.call_id === 'string' ? item.call_id : ''
      ctx.toolName = typeof item.name === 'string' ? item.name : ''
      ctx.toolArguments = typeof item.arguments === 'string' ? item.arguments : ''
      ctx.toolIndex = ctx.nextIndex++
      return [{ type: 'block-start', index: ctx.toolIndex, blockType: 'tool-call' }]
    }
    return []
  }

  if (name === 'response.output_text.delta') {
    const text = typeof data.delta === 'string' ? data.delta : typeof data.text === 'string' ? data.text : ''
    if (!text) return []
    const chunks: unknown[] = []
    if (ctx.textIndex === undefined) {
      ctx.textIndex = ctx.nextIndex++
      chunks.push({ type: 'block-start', index: ctx.textIndex, blockType: 'text' })
    }
    ctx.text += text
    chunks.push({ type: 'text-delta', index: ctx.textIndex, text })
    return chunks
  }

  if (name === 'response.reasoning_text.delta' || name === 'response.reasoning.delta') {
    const text = typeof data.delta === 'string' ? data.delta : typeof data.text === 'string' ? data.text : ''
    if (!text) return []
    const chunks: unknown[] = []
    if (ctx.reasoningIndex === undefined) {
      ctx.reasoningIndex = ctx.nextIndex++
      chunks.push({ type: 'block-start', index: ctx.reasoningIndex, blockType: 'reasoning' })
    }
    ctx.reasoning += text
    chunks.push({ type: 'reasoning-delta', index: ctx.reasoningIndex, text })
    return chunks
  }

  if (name === 'response.function_call_arguments.delta') {
    let delta = ''
    if (typeof data.delta === 'string') delta = data.delta
    else if (data.delta !== undefined) {
      try {
        delta = JSON.stringify(data.delta)
      } catch {
        delta = ''
      }
    }
    if (!delta) return []
    const chunks: unknown[] = []
    if (ctx.toolIndex === undefined) {
      ctx.toolId = typeof data.call_id === 'string' ? data.call_id : ctx.toolId
      ctx.toolName = typeof data.name === 'string' ? data.name : ctx.toolName
      ctx.toolIndex = ctx.nextIndex++
      chunks.push({ type: 'block-start', index: ctx.toolIndex, blockType: 'tool-call' })
    }
    ctx.toolArguments += delta
    chunks.push({
      type: 'tool-call-delta',
      index: ctx.toolIndex,
      id: ctx.toolId ?? '',
      name: ctx.toolName,
      argumentsDelta: delta,
    })
    return chunks
  }

  if (name === 'response.reasoning.encrypted_content' || name === 'response.reasoning_text.done') {
    rememberReplay(ctx, data)
    return []
  }

  if (name === 'response.completed' || name === 'response.failed' || name === 'done') {
    const response = asRecord(data.response) ?? data
    rememberReplay(ctx, response)
    rememberReplay(ctx, data)
    const tag = finishReasonFrom(response)
    const out = closeOpenBlocks(ctx)
    out.push({ type: 'usage', usage: usageFrom(response.usage) })
    const finish: Record<string, unknown> = { type: 'finish', reason: finishKind(tag, ctx, response) }
    if (ctx.replayState) finish.replayState = ctx.replayState
    out.push(finish)
    ctx.finished = true
    return out
  }

  return []
}
