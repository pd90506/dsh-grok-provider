export const PROXY_BASE = 'https://cli-chat-proxy.grok.com/v1'
export const FALLBACK_MODEL = 'grok-4.6'
export const STREAM_IDLE_TIMEOUT_MS = 300_000
export const PROVIDER_ROUTE = 'grok'
export const PLUGIN_NAME = 'llm-grok'

// Pinned first-party xAI OAuth URLs from pi-xai-oauth
// extensions/xai/constants.ts (BlockedPath/pi-xai-oauth, reviewed 2026-09-17):
//   XAI_OAUTH_ISSUER = "https://auth.x.ai"
//   XAI_OAUTH_AUTHORIZATION_URL = `${issuer}/oauth2/authorize`
//   XAI_OAUTH_DEVICE_URL = `${issuer}/oauth2/device/code`
//   XAI_OAUTH_TOKEN_URL = `${issuer}/oauth2/token`
//   XAI_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828" (public client id)
// User-Agent / product identity stays this package (dsh-grok-provider), not Grok CLI.
export const XAI_OAUTH_ISSUER = 'https://auth.x.ai'
export const XAI_OAUTH_AUTHORIZATION_URL = `${XAI_OAUTH_ISSUER}/oauth2/authorize`
export const XAI_OAUTH_DEVICE_URL = `${XAI_OAUTH_ISSUER}/oauth2/device/code`
export const XAI_OAUTH_TOKEN_URL = `${XAI_OAUTH_ISSUER}/oauth2/token`
export const XAI_OAUTH_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828'
export const XAI_OAUTH_SCOPE =
  'openid profile email offline_access grok-cli:access api:access conversations:read conversations:write'
export const XAI_OAUTH_DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'
export const XAI_OAUTH_DEVICE_SLOW_DOWN_MS = 5_000
export const XAI_OAUTH_DEVICE_MAX_DURATION_MS = 15 * 60 * 1000
export const XAI_GROK_CLI_AUTH_SCOPE_KEY = `${XAI_OAUTH_ISSUER}::${XAI_OAUTH_CLIENT_ID}`
export const XAI_GROK_CLI_LEGACY_AUTH_SCOPE_KEY = 'https://accounts.x.ai/sign-in'
export const PLUGIN_AUTH_DIR = '.dsh-grok-provider'
export const PLUGIN_AUTH_FILE = 'auth.json'
