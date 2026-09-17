import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
test('package identity and host stub export llm-grok', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.name, 'dsh-grok-provider')
  assert.equal(pkg.version, '2.0.0-alpha.0')
  const mod = await import(new URL('../dist/host/index.mjs', import.meta.url).href)
  assert.equal(mod.name, 'llm-grok')
  assert.deepEqual(mod.inject, ['llm'])
})
