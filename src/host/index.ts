import Schema from '@deepseek-ai/schemastery'
import { PLUGIN_NAME } from './constants.ts'

export const name = PLUGIN_NAME
export const inject = ['llm'] as const

export const Config = Schema.object({})

export function apply(_ctx: unknown, _config: unknown) {
  // Registration lands in later tasks; unit tests import modules directly.
}
