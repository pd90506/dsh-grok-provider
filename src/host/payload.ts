export type GenerateOptionsLike = {
  model: string
  messages?: unknown[]
  system?: string
  tools?: Array<{ name: string; description?: string; parameters?: Record<string, unknown> }>
  reasoningEffort?: string
  stop?: string[]
}

function throwUnsupported(message: string): never {
  const err = new Error(message) as Error & { code: string }
  err.code = 'UNSUPPORTED'
  throw err
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const rec = block as Record<string, unknown>
    if (rec.type === 'text' && typeof rec.text === 'string') parts.push(rec.text)
    if (rec.type === 'tool-result') {
      parts.push(textFromContent(rec.content))
    }
  }
  return parts.join('')
}

function encodeArguments(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return '{}'
  try {
    return JSON.stringify(value)
  } catch {
    return '{}'
  }
}

function mapFunctionCall(block: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'function_call',
    call_id: typeof block.id === 'string' ? block.id : typeof block.call_id === 'string' ? block.call_id : '',
    name: typeof block.name === 'string' ? block.name : '',
    arguments: encodeArguments(block.arguments),
  }
}

function mapMessage(message: unknown): Record<string, unknown>[] {
  if (!message || typeof message !== 'object') return []
  const rec = message as Record<string, unknown>
  const role = rec.role
  if (role === 'tool') {
    const callId =
      (rec.source && typeof rec.source === 'object' && (rec.source as Record<string, unknown>).callId) ||
      rec.toolCallId
    return [
      {
        type: 'function_call_output',
        call_id: typeof callId === 'string' ? callId : '',
        output: textFromContent(rec.content),
      },
    ]
  }
  if (role === 'assistant' && Array.isArray(rec.content)) {
    const items: Record<string, unknown>[] = []
    const text = textFromContent(rec.content)
    if (text) items.push({ role: 'assistant', content: text })
    for (const block of rec.content) {
      if (!block || typeof block !== 'object') continue
      const b = block as Record<string, unknown>
      if (b.type === 'tool-call') items.push(mapFunctionCall(b))
    }
    if (items.length > 0) return items
  }
  if (role === 'system' || role === 'user' || role === 'assistant') {
    return [{ role, content: textFromContent(rec.content) }]
  }
  return []
}

export function buildResponsesBody(options: GenerateOptionsLike): Record<string, unknown> {
  if (Array.isArray(options.stop) && options.stop.length > 0) {
    throwUnsupported('stop sequences are not supported on the xAI OAuth Responses route')
  }

  const input: Record<string, unknown>[] = []
  for (const message of options.messages ?? []) {
    input.push(...mapMessage(message))
  }

  const body: Record<string, unknown> = {
    model: options.model,
    stream: true,
    store: false,
    input,
  }

  if (typeof options.system === 'string' && options.system.length > 0) {
    body.instructions = options.system
  }
  if (options.reasoningEffort) {
    body.reasoning = { effort: options.reasoningEffort }
  }
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description ?? '',
      parameters: tool.parameters ?? { type: 'object', properties: {} },
    }))
  }
  return body
}
