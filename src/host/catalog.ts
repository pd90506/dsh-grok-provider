import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import { FALLBACK_MODEL, PROXY_BASE } from './constants.ts'
import { PACKAGE_IDENTITY, type PackageIdentity } from './identity.ts'

export const MODELS_V2_URL = `${PROXY_BASE}/models-v2`

const API_KEY_ONLY_IDS = new Set(['grok-build-0.1'])
const ID_RE = /^[a-zA-Z0-9._:-]+$/
const DEFAULT_TTL_MS = 15 * 60 * 1000

export type GrokModel = {
  id: string
  name: string
  contextWindow: number
  reasoningEfforts: string[]
  defaultEffort?: string
  input: Array<'text' | 'image'>
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function listFromJson(json: unknown): unknown[] {
  if (Array.isArray(json)) return json
  const rec = asRecord(json)
  if (!rec) return []
  if (Array.isArray(rec.data)) return rec.data
  if (Array.isArray(rec.models)) return rec.models
  return []
}

function asInput(value: unknown): Array<'text' | 'image'> {
  const out: Array<'text' | 'image'> = []
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item === 'text' || item === 'image') out.push(item)
    }
  }
  if (!out.includes('text')) out.unshift('text')
  return out
}

function asEfforts(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function normalizeOne(entry: unknown): GrokModel | undefined {
  const rec = asRecord(entry)
  if (!rec) return undefined
  const id = rec.id
  if (typeof id !== 'string' || !ID_RE.test(id)) return undefined
  if (API_KEY_ONLY_IDS.has(id)) return undefined
  const name = typeof rec.name === 'string' && rec.name ? rec.name : id
  const contextWindowRaw = rec.contextWindow ?? rec.context_window
  const contextWindow =
    typeof contextWindowRaw === 'number' && Number.isFinite(contextWindowRaw) && contextWindowRaw > 0
      ? contextWindowRaw
      : 131072
  const reasoningEfforts = asEfforts(rec.reasoningEfforts ?? rec.reasoning_efforts)
  const defaultEffort =
    typeof rec.defaultEffort === 'string'
      ? rec.defaultEffort
      : typeof rec.default_effort === 'string'
        ? rec.default_effort
        : undefined
  const input = asInput(rec.input)
  const model: GrokModel = { id, name, contextWindow, reasoningEfforts, input }
  if (defaultEffort) model.defaultEffort = defaultEffort
  return model
}

export function normalizeModelsV2(json: unknown): GrokModel[] {
  const out: GrokModel[] = []
  for (const entry of listFromJson(json)) {
    const model = normalizeOne(entry)
    if (model) out.push(model)
  }
  return out
}

export function fallbackCatalog(): GrokModel[] {
  return [
    {
      id: FALLBACK_MODEL,
      name: 'Grok 4.6',
      contextWindow: 500000,
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
      defaultEffort: 'high',
      input: ['text', 'image'],
    },
  ]
}

export class CatalogCache {
  #models: GrokModel[] | undefined
  #fetchedAt: number | undefined

  get(): GrokModel[] | undefined {
    return this.#models?.map((model) => ({
      ...model,
      reasoningEfforts: [...model.reasoningEfforts],
      input: [...model.input],
    }))
  }

  set(models: GrokModel[], fetchedAt: number): void {
    this.#models = models.map((model) => ({
      ...model,
      reasoningEfforts: [...model.reasoningEfforts],
      input: [...model.input],
    }))
    this.#fetchedAt = fetchedAt
  }

  isFresh(now: number, ttlMs = DEFAULT_TTL_MS): boolean {
    if (this.#fetchedAt === undefined) return false
    return now - this.#fetchedAt < ttlMs
  }
}

export async function fetchModelsV2(options: {
  accessToken: string
  fetch: typeof fetch
  identity?: PackageIdentity
}): Promise<GrokModel[]> {
  const identity = options.identity ?? PACKAGE_IDENTITY
  const response = await options.fetch(MODELS_V2_URL, {
    method: 'GET',
    headers: {
      ...attributionHeaders(identity),
      accept: 'application/json',
      authorization: `Bearer ${options.accessToken}`,
    },
    redirect: 'error',
  })
  if (!response.ok) {
    throw new Error(`models-v2 request failed with status ${response.status}`)
  }
  return normalizeModelsV2(await response.json())
}
