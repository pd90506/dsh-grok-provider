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

const MAX_IMAGE_URL_CHARS = 400 * 1024

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function boundedImageUrl(raw: string): string | undefined {
  const url = raw.trim()
  if (!url) return undefined
  if (url.length > MAX_IMAGE_URL_CHARS) return undefined
  if (/^data:image\/(png|jpe?g);base64,/i.test(url)) return url
  if (/^https?:\/\//i.test(url)) return url
  return undefined
}

function imageUrlFromBlock(block: Record<string, unknown>): string | undefined {
  if (typeof block.image_url === 'string') return boundedImageUrl(block.image_url)
  const nested = asRecord(block.image_url)
  if (nested && typeof nested.url === 'string') return boundedImageUrl(nested.url)
  if (typeof block.url === 'string') return boundedImageUrl(block.url)
  const source = asRecord(block.source)
  if (source && typeof source.url === 'string') return boundedImageUrl(source.url)
  return undefined
}

function userContentParts(content: unknown): unknown {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return textFromContent(content)
  const parts: Record<string, unknown>[] = []
  for (const block of content) {
    const rec = asRecord(block)
    if (!rec) continue
    if (rec.type === 'text' && typeof rec.text === 'string') {
      parts.push({ type: 'input_text', text: rec.text })
      continue
    }
    if (rec.type === 'image' || rec.type === 'image_url' || rec.type === 'input_image') {
      const url = imageUrlFromBlock(rec)
      if (url) parts.push({ type: 'input_image', image_url: url, detail: 'auto' })
    }
  }
  if (parts.length === 0) return textFromContent(content)
  if (parts.length === 1 && parts[0].type === 'input_text') return parts[0].text
  return parts
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
  if (role === 'user') {
    return [{ role: 'user', content: userContentParts(rec.content) }]
  }
  if (role === 'system' || role === 'assistant') {
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
    reasoning: {
      encrypted_content: true,
      ...(options.reasoningEffort ? { effort: options.reasoningEffort } : {}),
    },
  }

  if (typeof options.system === 'string' && options.system.length > 0) {
    body.instructions = options.system
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
