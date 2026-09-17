import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type PackageIdentity = {
  product: string
  version: string
  url: string
}

function loadIdentity(): PackageIdentity {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '../../package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    name: string
    version: string
    homepage?: string
  }
  return {
    product: pkg.name,
    version: pkg.version,
    url: pkg.homepage ?? 'https://github.com/pd90506/dsh-grok-provider',
  }
}

export const PACKAGE_IDENTITY = loadIdentity()
