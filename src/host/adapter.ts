import { LlmAdapter, LlmError, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { CatalogCache, fallbackCatalog, type GrokModel } from './catalog.ts'
import { STREAM_IDLE_TIMEOUT_MS } from './constants.ts'
import { streamResponses, type FetchLike } from './transport.ts'

export type GrokAdapterOptions = {
  fetch?: FetchLike
  getAccessToken: () => Promise<string | null>
  catalog?: CatalogCache
  idleTimeoutMs?: number
}

function mergeFallback(model: GrokModel): GrokModel {
  const fb = fallbackCatalog().find((m) => m.id === model.id)
  if (!fb) return model
  const reasoningEfforts = model.reasoningEfforts.length > 0 ? model.reasoningEfforts : fb.reasoningEfforts
  const contextWindow = model.contextWindow > 0 ? model.contextWindow : fb.contextWindow
  const defaultEffort = model.defaultEffort ?? fb.defaultEffort
  const input = model.input.length > 0 ? model.input : fb.input
  const merged: GrokModel = {
    id: model.id,
    name: model.name || fb.name,
    contextWindow,
    reasoningEfforts: [...reasoningEfforts],
    input: [...input],
  }
  if (defaultEffort) merged.defaultEffort = defaultEffort
  return merged
}

function listing(cache?: CatalogCache): GrokModel[] {
  const cached = cache?.get()
  const models = cached && cached.length > 0 ? cached : fallbackCatalog()
  return models.map((model) => (model.id === 'grok-4.6' ? mergeFallback(model) : model))
}

export class GrokAdapter extends LlmAdapter {
  #fetch: FetchLike
  #getAccessToken: () => Promise<string | null>
  #catalog: CatalogCache
  #idleTimeoutMs: number

  constructor(options: GrokAdapterOptions) {
    super()
    this.#fetch = options.fetch ?? fetch
    this.#getAccessToken = options.getAccessToken
    this.#catalog = options.catalog ?? new CatalogCache()
    this.#idleTimeoutMs = options.idleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS
  }

  override providerInfo(provider: string) {
    if (provider === 'grok') return { id: 'grok', name: 'Grok (SuperGrok)' }
    return { id: provider, name: provider }
  }

  override async listModels(provider: string) {
    return listing(this.#catalog).map((model) => ({
      provider,
      id: model.id,
      name: model.name,
      inputModalities: model.input,
    }))
  }

  #requireModel(model: string): GrokModel {
    const found = listing(this.#catalog).find((m) => m.id === model)
    if (!found) {
      throw new LlmError(`unsupported model ${model}`, 'UNSUPPORTED')
    }
    return found.id === 'grok-4.6' ? mergeFallback(found) : found
  }

  override async resolveModel(provider: string, model: string) {
    const resolved = this.#requireModel(model)
    return {
      provider,
      id: resolved.id,
      name: resolved.name,
      inputModalities: resolved.input,
      context: { contextWindow: resolved.contextWindow },
      reasoning: {
        efforts: resolved.reasoningEfforts.map((id) => ({ id, name: id })),
        ...(resolved.defaultEffort ? { defaultEffort: resolved.defaultEffort } : {}),
      },
    }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const token = await this.#getAccessToken()
    if (!token) {
      throw new LlmError('not authenticated', 'AUTH')
    }
    this.#requireModel(options.model)
    try {
      yield* streamResponses({
        fetch: this.#fetch,
        accessToken: token,
        generate: options,
        idleTimeoutMs: this.#idleTimeoutMs,
      }) as AsyncIterable<StreamChunk>
    } catch (err) {
      if (err instanceof LlmError) throw err
      const code = (err as { code?: string }).code
      if (code === 'UNSUPPORTED') {
        throw new LlmError(err instanceof Error ? err.message : 'unsupported', 'UNSUPPORTED', { cause: err })
      }
      throw err
    }
  }
}
