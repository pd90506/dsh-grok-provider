# SuperGrok OAuth dsh-grok-provider Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CLI-spawn Grok Build fork with a clean-room DSH `0.1.5-rc.2` LLM adapter plus Settings login that uses SuperGrok xAI OAuth and the cli-chat-proxy Responses protocol.

**Architecture:** Host plugin `llm-grok` registers `LlmAdapter` on route `grok`. OAuth (PKCE browser + device), credential store, `/models-v2` catalog, Responses SSE→`StreamChunk`, and a thin Web Settings client. No pi runtime, no official CLI spawn, no quota/native xAI tools.

**Tech Stack:** Node ESM, TypeScript compiled by a small `scripts/build.mjs` (esbuild), Node test runner, `@deepseek-ai/dsh-llm` / `cordis` / `schemastery` / settings / client-connection at `0.1.5-rc.2`.

**Spec:** `docs/superpowers/specs/2026-09-17-dsh-grok-provider-design.md`

## Global Constraints

- Target DSH host exactly `0.1.5-rc.2`; peer + devDependencies must match that version (`cordis@4.0.2`, `schemastery@3.18.2`, `@deepseek-ai/dsh-*@0.1.5-rc.2`).
- Package name `dsh-grok-provider`; plugin export `name` is `llm-grok`; provider route is `grok`.
- GitHub remote is `https://github.com/pd90506/dsh-grok-provider.git` (non-fork). Do not add or push `yoshino-xiao7`.
- Repo-local git identity: `pd90506 <pd90506@gmail.com>`.
- Do not depend on `@earendil-works/*` or `pi-xai-oauth`. Protocol may be read from pi-xai-oauth docs/source as reference only.
- OAuth chat traffic uses `https://cli-chat-proxy.grok.com/v1` only. No API-key fallback to `api.x.ai`.
- Do not spawn `grok` CLI. Do not write `~/.grok/auth.json`. Read-only reuse of that file is allowed.
- Do not implement usage/quota UI or xAI native tools (web_search, image, video, code interpreter).
- Send `attributionHeaders()` from `@deepseek-ai/dsh-llm` on every provider HTTP request; User-Agent must identify `dsh-grok-provider` truthfully, never impersonate official Grok CLI.
- `stream()`: `usage` before `finish`; nothing after `finish`; empty completion is `EMPTY_RESPONSE`; honor `AbortSignal`; one attempt; idle timeout default 300000 ms.
- Preserve `docs/superpowers/specs/2026-09-17-dsh-grok-provider-design.md` and this plan file across any tree wipe.
- Tests: `node --test test/*.test.mjs` after `npm run build`.
- Do not `npm publish`. Do not `git push` unless a later finishing step is explicitly run.

---

## File map (locked)

Create (after Task 1 wipe of old fork sources):

- `package.json`, `dsh-plugin.naming.json`, `grok-provider.patch.yml`, `tsconfig.json`, `.gitignore`, `LICENSE`, `README.md`
- `scripts/build.mjs`
- `src/host/constants.ts` — URLs, timeouts, fallback model `grok-4.6`
- `src/host/pkce.ts` — S256 verifier/challenge
- `src/host/oauth.ts` — browser PKCE + device login + refresh (pure functions + injectable fetch/listen)
- `src/host/credentials.ts` — plugin token file under `~/.dsh-grok-provider/auth.json` (mode 0600); optional read of `~/.grok/auth.json`
- `src/host/catalog.ts` — `/models-v2` normalize + TTL cache + fallback
- `src/host/payload.ts` — `GenerateOptions` → Responses body
- `src/host/chunks.ts` — Responses SSE events → `StreamChunk[]`
- `src/host/transport.ts` — fetch stream, idle timeout, attribution headers
- `src/host/adapter.ts` — `GrokAdapter extends LlmAdapter`
- `src/host/index.ts` — `apply`, Config, registerAdapter, settings RPC
- `src/client/settings.ts` — Settings page
- `test/pkce.test.mjs`, `test/oauth.test.mjs`, `test/catalog.test.mjs`, `test/chunks.test.mjs`, `test/payload.test.mjs`, `test/adapter-errors.test.mjs`, `test/attribution.test.mjs`

Delete (Task 1): old `src/`, `client.js`, `spikes/`, `dist/`, `types/`, `CHANGELOG.md`, `README.en.md`, `CONTRIBUTING.md`, `SECURITY.md`, `THIRD_PARTY_NOTICES.md`, `screenshots.json`, old tests, `package-lock.json` if switching to npm lock regenerated.

---

### Task 1: Bootstrap package (wipe fork sources, naming, build)

**Files:**
- Create: `package.json`, `dsh-plugin.naming.json`, `grok-provider.patch.yml`, `tsconfig.json`, `.gitignore`, `scripts/build.mjs`, `src/host/index.ts` (stub), `src/host/constants.ts`
- Keep: `docs/superpowers/**`, `LICENSE` if MIT, `.git`
- Delete: leftover fork implementation files listed above

**Interfaces:**
- Consumes: none
- Produces: `export const name = 'llm-grok'`; `package.json` name `dsh-grok-provider`; `dsh.bundle.patch` = `grok-provider.patch.yml`; build emits `dist/host/index.mjs` and `dist/client/client.js`

- [ ] **Step 1: Write failing naming manifest + stub so validate-names can run**

Create `dsh-plugin.naming.json`:

```json
{
  "schemaVersion": 1,
  "policy": "dsh-plugin-naming/v1",
  "plugin": {
    "namespace": "pd90506",
    "name": "grok-provider",
    "coordinate": "pd90506/grok-provider",
    "packageName": "dsh-grok-provider"
  },
  "names": {
    "pluginNames": ["llm-grok"],
    "loaderIds": ["llm-grok"],
    "services": [],
    "tools": [],
    "commands": [],
    "skills": [],
    "skillProviders": [],
    "events": [],
    "settingsNamespaces": ["llm-grok"],
    "routes": []
  }
}
```

- [ ] **Step 2: Run offline naming validator**

Run: `node /home/panda-nuc/.agents/skills/plugin-write/scripts/validate-names.mjs --manifest ./dsh-plugin.naming.json`

Expected: exit 0 (warnings on short ids are OK; do not use `--strict`).

- [ ] **Step 3: Replace package.json / patch / tsconfig / build / stub apply**

`package.json` must include:

- `"name": "dsh-grok-provider"`, `"version": "2.0.0-alpha.0"`, `"type": "module"`
- `exports["."]` → `dist/host/index.mjs` + types
- `exports["./client"]` → `dist/client/client.js`
- `dsh.bundle.patch`: `grok-provider.patch.yml`
- `dsh.client.inject`: `@deepseek-ai/dsh-client-connection`, `@deepseek-ai/dsh-client-locale`, `@deepseek-ai/dsh-client-ui-renderer`, `@deepseek-ai/dsh-client-ui-settings`
- `dsh.client.platform`: `web`
- peers as Global Constraints
- scripts: `"build": "node scripts/build.mjs"`, `"test": "npm run build && node --test test/*.test.mjs"`

`grok-provider.patch.yml` must load the plugin as host `llm-grok` from the package root export.

`src/host/constants.ts`:

```ts
export const PROXY_BASE = 'https://cli-chat-proxy.grok.com/v1'
export const FALLBACK_MODEL = 'grok-4.6'
export const STREAM_IDLE_TIMEOUT_MS = 300_000
export const PROVIDER_ROUTE = 'grok'
export const PLUGIN_NAME = 'llm-grok'
```

Stub `apply` exports `name`, `inject = ['llm']`, empty `Config`, `apply` that throws `new Error('not implemented')` until later tasks — **wait**: later tasks need apply to register. Stub `apply` as no-op that only exports name, so tests of later units import modules directly.

`scripts/build.mjs`: esbuild `src/host/index.ts` → `dist/host/index.mjs` (platform node, format esm); bundle client when present, otherwise emit a placeholder `dist/client/client.js` exporting empty apply.

- [ ] **Step 4: `npm install` and `npm run build`**

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: bootstrap clean dsh-grok-provider package for SuperGrok rewrite"
```

---

### Task 2: PKCE + OAuth state helpers

**Files:**
- Create: `src/host/pkce.ts`, `test/pkce.test.mjs`

**Interfaces:**
- Consumes: none
- Produces:
  - `generatePkce(): Promise<{ verifier: string, challenge: string, method: 'S256' }>`
  - `generateOAuthState(): string` (32+ bytes hex)
  - `parseRedirectUrl(url: string, expectedState: string): { code: string }` — throws if missing code, missing state, or state mismatch; rejects raw codes that are not URLs

- [ ] **Step 1: Write failing tests** in `test/pkce.test.mjs` using `node:test` / `node:assert/strict`, importing from `../dist/host/pkce.mjs` **or** if build only emits index bundle, export pkce from a dedicated build entry.

**Ruling for implementer:** `scripts/build.mjs` must also emit `dist/host/pkce.mjs`, `dist/host/oauth.mjs`, `dist/host/catalog.mjs`, `dist/host/chunks.mjs`, `dist/host/payload.mjs` as separate esbuild entry points so unit tests import them without the full adapter.

Tests:

```js
test('S256 challenge is base64url without padding', async () => {
  const { verifier, challenge, method } = await generatePkce()
  assert.equal(method, 'S256')
  assert.match(verifier, /^[A-Za-z0-9_-]+$/)
  assert.doesNotMatch(challenge, /=/)
})

test('parseRedirectUrl requires matching state', () => {
  const state = generateOAuthState()
  const code = parseRedirectUrl(`http://127.0.0.1:9/cb?code=abc&state=${state}`, state)
  assert.equal(code.code, 'abc')
  assert.throws(() => parseRedirectUrl(`http://127.0.0.1:9/cb?code=abc&state=nope`, state))
  assert.throws(() => parseRedirectUrl('abc', state))
})
```

- [ ] **Step 2: Run tests — expect FAIL** (`generatePkce` not found)

- [ ] **Step 3: Implement `src/host/pkce.ts`** using `crypto.subtle` or `node:crypto`

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit** `feat: add PKCE and redirect-state helpers`

---

### Task 3: Catalog normalize + fallback

**Files:**
- Create: `src/host/catalog.ts`, `test/catalog.test.mjs`

**Interfaces:**
- Consumes: `PROXY_BASE`, `FALLBACK_MODEL`
- Produces:
  - `type GrokModel = { id: string, name: string, contextWindow: number, reasoningEfforts: string[], defaultEffort?: string, input: Array<'text'|'image'> }`
  - `normalizeModelsV2(json: unknown): GrokModel[]` — drop entries without string `id`; drop known API-key-only `grok-build-0.1`; require id matching `/^[a-zA-Z0-9._:-]+$/`
  - `fallbackCatalog(): GrokModel[]` — one entry `grok-4.6`, contextWindow 500000, efforts `low|medium|high|xhigh`, defaultEffort `high`, input text+image
  - `CatalogCache` class: `get()`, `set(models, fetchedAt)`, `isFresh(now, ttlMs = 15 * 60 * 1000)`

- [ ] **Step 1: Failing tests** covering: empty/invalid json → `[]`; filters `grok-build-0.1`; fallback shape; TTL freshness true/false

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement catalog.ts**

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit** `feat: normalize grok models-v2 catalog with grok-4.6 fallback`

---

### Task 4: Responses payload + SSE chunk mapping

**Files:**
- Create: `src/host/payload.ts`, `src/host/chunks.ts`, `test/payload.test.mjs`, `test/chunks.test.mjs`

**Interfaces:**
- Consumes: `GenerateOptions` shape (plain objects in tests)
- Produces:
  - `buildResponsesBody(options): Record<string, unknown>` with `model`, `stream: true`, `store: false`, `input` array, optional `tools`, `instructions` from `options.system`, `reasoning.effort` from `options.reasoningEffort`
  - If `options.stop` is a non-empty array, `buildResponsesBody` throws an error with code `UNSUPPORTED` (xAI OAuth Responses v1 does not map stop lists)
  - `mapSseEvent(event: { event?: string, data: unknown }, ctx: MapperState): StreamChunk[]`
  - Mapper must emit block-start before first delta; tool arguments as string deltas; buffer finish until end; empty output + stop → caller maps EMPTY_RESPONSE (provide `finishReasonFrom(response): 'empty' | 'stop' | 'error' | 'aborted'`)

- [ ] **Step 1: Tests**

payload: system becomes `instructions`; tools mapped to Responses function tools; stop throws.

chunks: text delta sequence produces block-start, text-delta, and later usage then finish; tool-call argument fragments stay strings; never emit after finish.

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement**

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit** `feat: map DSH requests and Responses SSE to StreamChunk`

---

### Task 5: Credentials + OAuth token exchange (injectable fetch)

**Files:**
- Create: `src/host/credentials.ts`, `src/host/oauth.ts`, `test/oauth.test.mjs`

**Interfaces:**
- Consumes: pkce helpers, constants
- Produces:
  - `type TokenSet = { accessToken: string, refreshToken?: string, expiresAt: number, tokenType: 'Bearer' }`
  - `CredentialStore` with `read(): Promise<TokenSet | null>`, `write(t: TokenSet): Promise<void>`, `clear(): Promise<void>` using `~/.dsh-grok-provider/auth.json` (override `homeDir` in tests)
  - `readGrokCliAuth(homeDir): Promise<TokenSet | null>` — read-only `~/.grok/auth.json`; never writes
  - `exchangeCode({ code, verifier, redirectUri, fetch }): Promise<TokenSet>`
  - `refreshTokens({ refreshToken, fetch }): Promise<TokenSet>`
  - `pollDevice({ deviceCode, intervalMs, fetch, signal }): Promise<TokenSet>`
  - OAuth authorization/token/device URLs: copy **pinned first-party xAI URLs** from pi-xai-oauth `constants` (read the published source; do not invent). Document the chosen literals in a comment in `constants.ts`.

- [ ] **Step 1: Tests with mock fetch** — successful code exchange stores access+refresh; state already tested; refresh posts refresh_token; device pending then success; credential file mode not world-readable (skip on win); grok CLI reader does not write

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement**

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit** `feat: SuperGrok OAuth token exchange and credential store`

---

### Task 6: GrokAdapter + transport + error mapping

**Files:**
- Create: `src/host/transport.ts`, `src/host/adapter.ts`, `test/adapter-errors.test.mjs`, `test/attribution.test.mjs`

**Interfaces:**
- Consumes: payload, chunks, catalog, credentials, constants
- Produces: `class GrokAdapter extends LlmAdapter`
  - `providerInfo('grok')` → `{ id: 'grok', name: 'Grok (SuperGrok)' }`
  - `listModels('grok')` uses catalog cache or fallback
  - `resolveModel` returns contextWindow and reasoning efforts from catalog or fallback for `grok-4.6`
  - `stream(options)`: require bearer; POST `${PROXY_BASE}/responses`; headers include `attributionHeaders()` plus `Authorization`; map SSE; idle timeout `STREAM_IDLE_TIMEOUT_MS`; abort → `ABORTED`; HTTP 401 → `AUTH`; empty → finish error `EMPTY_RESPONSE`
  - Inject `fetch` via constructor for tests

- [ ] **Step 1: Tests** — mock fetch captures User-Agent containing product from attributionHeaders; abort signal; empty output maps EMPTY_RESPONSE; no request if no token (`AUTH`)

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement**

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit** `feat: register GrokAdapter stream against cli-chat-proxy`

---

### Task 7: Plugin apply + Settings client

**Files:**
- Modify: `src/host/index.ts`
- Create: `src/client/settings.ts` (or `.tsx` if the target settings API uses hyperscript — match `0.1.5-rc.2` `@deepseek-ai/dsh-client-ui-settings` as used by the old plugin's `client.js` **patterns only**, not its OAuth CLI code)
- Test: `test/plugin-exports.test.mjs`

**Interfaces:**
- Consumes: GrokAdapter, oauth, credentials
- Produces:
  - `export const name = 'llm-grok'`
  - `export const inject = ['llm', 'settings']` (settings optional if missing at typecheck — include in inject if the host always has it in web profile)
  - `export const Config` schemastery object: `streamIdleTimeoutMs` default 300000
  - `apply(ctx, config)` registers adapter on `['grok']`; registers settings section "Grok" with actions login-browser, login-device, logout, refresh-catalog
  - Client: buttons calling host methods over client-connection; show logged-in vs logged-out; never display tokens

- [ ] **Step 1: Test** `import { name } from '../dist/host/index.mjs'` equals `llm-grok`; Config has streamIdleTimeoutMs

- [ ] **Step 2: FAIL if stub still throws**

- [ ] **Step 3: Implement apply + settings UI**

Inspect `node_modules/@deepseek-ai/dsh-settings` and `dsh-client-ui-settings` at 0.1.5-rc.2 for the exact register API. Do not guess against older forks.

- [ ] **Step 4: `npm test` full suite PASS**

- [ ] **Step 5: Commit** `feat: Settings login UI and llm-grok apply wiring`

---

### Task 8: README + naming re-validate

**Files:**
- Create: `README.md` (replace)
- Modify: none of the protocol code unless docs find a mismatch

- [ ] **Step 1: Write README** covering install into DSH web profile via github `pd90506/dsh-grok-provider`, SuperGrok OAuth, non-goals, Linux/macOS/Windows, not affiliated with xAI/DeepSeek

- [ ] **Step 2: Re-run naming validator**

- [ ] **Step 3: `npm test`**

- [ ] **Step 4: Commit** `docs: README for SuperGrok OAuth provider v2`

---

## Self-review

- Spec goals (OAuth both modes, catalog, adapter stream, settings, names, non-goals) each have a task.
- No quota/native tools/CLI spawn tasks.
- Types: `TokenSet`, `GrokModel`, `PROVIDER_ROUTE`, `PLUGIN_NAME` used consistently.
- Push is out of scope until finishing-a-development-branch.
