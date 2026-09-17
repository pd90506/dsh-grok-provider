# dsh-grok-provider rewrite (SuperGrok OAuth, pi-xai-oauth style)

Date: 2026-09-17  
Status: draft for user review  
Target host: DeepSeek Harness `0.1.5-rc.2`  
GitHub: https://github.com/pd90506/dsh-grok-provider (new, not a fork)

## Problem

The previous repository was a fork of `yoshino-xiao7/dsh-grok-provider`. It authenticated by spawning the official Grok Build CLI (`grok login --oauth`). The maintainer uses a SuperGrok subscription and wants a clean-room DSH plugin whose login, catalog, and Responses transport follow [pi-xai-oauth](https://pi.dev/packages/pi-xai-oauth), not the CLI-spawn path and not a pi runtime dependency.

## Goals (v1)

- External DSH plugin: LLM adapter + Config + light Web Settings.
- SuperGrok / xAI account OAuth (browser PKCE + device code), token refresh.
- Optional read-only reuse of `~/.grok/auth.json`; never write back to that file.
- Authenticated model catalog via `GET https://cli-chat-proxy.grok.com/v1/models-v2`, with offline fallback `grok-4.6`.
- Register `LlmAdapter` on route `grok` with plugin name `llm-grok`.
- Stream chat, tool calls, and reasoning into DSH `StreamChunk` vocabulary.
- Settings page: login, logout, status, refresh catalog. No conversation UI.

## Non-goals (v1)

- Usage / quota dashboard (`/xai-usage`).
- xAI native tools (web search, X search, image gen/edit, video, code interpreter).
- Spawning the official `grok` CLI.
- API-key traffic to `api.x.ai` as a second chat path.
- Depending on `@earendil-works/*` or `pi-xai-oauth`.
- npm publish.

## Approach

Clean-room reimplementation of the pi-xai-oauth *protocol* inside a DSH adapter (Approach A). Protocol reference is pi-xai-oauth 1.5.2; DSH contracts come only from `@deepseek-ai/*` at `0.1.5-rc.2`.

## Public names

| Surface | Value |
|---|---|
| Package | `dsh-grok-provider` |
| Plugin `name` | `llm-grok` |
| Provider route | `grok` |
| GitHub | `pd90506/dsh-grok-provider` |

Community naming may warn on short ids. v1 does not rename.

## Architecture

```
Web Settings  --rpc-->  Host plugin (llm-grok)
                            ├── oauth (PKCE / device)
                            ├── credentials (plugin store + optional ~/.grok/auth.json read)
                            ├── catalog (/models-v2 + LKG fallback)
                            ├── payload (DSH GenerateOptions → Responses body)
                            ├── transport (one attempt, idle timeout, attribution)
                            └── adapter (stream / resolveModel / listModels)
                                      │
                                      ▼
                         cli-chat-proxy.grok.com (OAuth Responses)
```

## Host adapter contract (DSH 0.1.5-rc.2)

- `export const name = 'llm-grok'`
- `inject` includes `llm` (and settings/client as required by the target checkout).
- `ctx.llm.registerAdapter(['grok'], adapter)` is effect-based and HMR-safe.
- `stream()` emits only the closed `StreamChunk` union; `usage` before `finish`; nothing after `finish`.
- Empty completion → `EMPTY_RESPONSE`.
- Honor `options.signal`. Unsupported GenerateOptions fields → `LlmError` `UNSUPPORTED`.
- `resolveModel()` returns identity, context window, ordered reasoning efforts (`low` / `medium` / `high` / `xhigh` as catalog allows). Grok 4.6 defaults to high when that is the provider default.
- `attributionHeaders()` on every provider HTTP request.
- One adapter call = one provider attempt; no client-library retries.
- Finite `streamIdleTimeoutMs` (default 5 minutes).

## Authentication

- Browser login (default): loopback callback, PKCE S256, matching `state`; paste fallback must be the full redirect URL, not a raw code.
- Device login: pinned device endpoint, user-visible URL + user code, bounded poll, cancel on abort.
- Store access + refresh only after a completed login.
- Refresh automatically before expiry; failed refresh marks logged-out.
- Do not impersonate the official Grok CLI client identity; send truthful package `User-Agent` / product headers.

## Catalog

- After login, bounded GET `/v1/models-v2`.
- Filter unsafe / API-key-only entries (e.g. do not advertise `grok-build-0.1` on the OAuth route unless the catalog explicitly entitles an OAuth-safe equivalent).
- Cache last-known-good with a short TTL; on failure use curated fallback with `grok-4.6`.

## Transport

- OAuth/session Responses: `https://cli-chat-proxy.grok.com/v1`.
- No silent fallback to `api.x.ai` API keys.
- Map Responses SSE to DSH chunks: text, reasoning, tool-call argument deltas, usage, finish.
- Encrypted reasoning replay only when provider+model still match; otherwise drop replay state.

## Web Settings

- Login (browser / device), logout, connection status, last error, catalog refresh.
- Does not inject conversation nodes.

## Repository bootstrap

- Replace the old fork working tree and git history.
- Repo-local git identity: `pd90506 <pd90506@gmail.com>`.
- Push `main` to the new GitHub remote only.
- Include `dsh-plugin.naming.json` and validate with plugin-write scripts against harness `0.1.5-rc.2`.

## Testing

- Unit: PKCE/state, catalog normalize, chunk conversion, error classification, attribution headers (wire mock).
- Real SuperGrok API tests only when credentials exist and the user authorizes.
- No tests for usage, native xAI tools, or CLI spawn.

## Success criteria

- Cold-load in DSH `0.1.5-rc.2` web profile.
- Settings login completes with SuperGrok.
- At least `grok-4.6` selectable.
- One message → (optional tool) → streamed reply round-trip.

## Open implementation details (fixed here)

- Default provider route string is `grok`, not `xai-auth` (DSH has no pi provider registry).
- v1 does not implement Grok-native local fs/shell adapters; DSH tools stay on the host tool plugins.
