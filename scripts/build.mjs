import { mkdir, writeFile, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const hostEntry = join(root, 'src/host/index.ts')
const clientEntry = join(root, 'src/client/settings.ts')
const hostOut = join(root, 'dist/host/index.mjs')
const clientOut = join(root, 'dist/client/client.js')

await mkdir(dirname(hostOut), { recursive: true })
await mkdir(dirname(clientOut), { recursive: true })

await esbuild.build({
  absWorkingDir: root,
  entryPoints: [hostEntry],
  outfile: hostOut,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
})

let clientPresent = false
try {
  await access(clientEntry)
  clientPresent = true
} catch {
  clientPresent = false
}

if (clientPresent) {
  await esbuild.build({
    absWorkingDir: root,
    entryPoints: [clientEntry],
    outfile: clientOut,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    sourcemap: true,
    logLevel: 'info',
  })
} else {
  await writeFile(
    clientOut,
    'export const name = "llm-grok-client"\nexport function apply() {}\n',
    'utf8',
  )
}
