import { mkdir, writeFile, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const hostEntry = join(root, 'src/host/index.ts')
const clientEntryTs = join(root, 'src/client/settings.ts')
const clientEntryTsx = join(root, 'src/client/settings.tsx')
const hostOut = join(root, 'dist/host/index.mjs')
const clientOut = join(root, 'dist/client/client.js')
const extraHostModules = [
  'pkce',
  'oauth',
  'catalog',
  'chunks',
  'payload',
  'credentials',
  'constants',
  'transport',
  'adapter',
  'identity',
]

await mkdir(dirname(hostOut), { recursive: true })
await mkdir(dirname(clientOut), { recursive: true })

const hostBuild = {
  absWorkingDir: root,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
}

await esbuild.build({
  ...hostBuild,
  entryPoints: [hostEntry],
  outfile: hostOut,
})

for (const name of extraHostModules) {
  const extraEntry = join(root, `src/host/${name}.ts`)
  try {
    await access(extraEntry)
  } catch {
    continue
  }
  await esbuild.build({
    ...hostBuild,
    entryPoints: [extraEntry],
    outfile: join(root, `dist/host/${name}.mjs`),
  })
}

let clientEntry = clientEntryTsx
try {
  await access(clientEntryTsx)
} catch {
  try {
    await access(clientEntryTs)
    clientEntry = clientEntryTs
  } catch {
    clientEntry = ''
  }
}

if (clientEntry) {
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
    jsx: 'automatic',
    external: ['react', 'react/jsx-runtime', '@deepseek-ai/cordis'],
  })
} else {
  await writeFile(
    clientOut,
    'export const name = "llm-grok-client"\nexport function apply() {}\n',
    'utf8',
  )
}
