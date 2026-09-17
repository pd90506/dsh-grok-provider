import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

test('package identity and host stub export llm-grok', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.name, 'dsh-grok-provider')
  assert.equal(pkg.version, '2.0.0-alpha.0')
  const mod = await import(new URL('../dist/host/index.mjs', import.meta.url).href)
  assert.equal(mod.name, 'llm-grok')
  assert.deepEqual([...mod.inject], ['llm', 'settings'])
})

test('package.json does not advertise missing types and does not pack leftover docs', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.types, undefined)
  assert.equal(pkg.exports['.']?.types, undefined)
  assert.deepEqual(pkg.files, [
    'dist',
    'grok-provider.patch.yml',
    'dsh-plugin.naming.json',
    'README.md',
    'LICENSE',
  ])
  assert.equal(pkg.devDependencies.esbuild, '0.25.12')
})

test('fork leftover docs and github workflows are gone', async () => {
  const missing = [
    'docs/adr',
    'docs/releases',
    'docs/01-product-requirements.md',
    'docs/README.md',
    '.github/workflows/ci.yml',
    '.github/workflows/release.yml',
    '.github/assets/plugin-preview/account-dashboard.png',
  ]
  for (const rel of missing) {
    await assert.rejects(() => access(join(root, rel)))
  }
  await access(join(root, 'docs/superpowers/specs/2026-09-17-dsh-grok-provider-design.md'))
})
