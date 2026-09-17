# dsh-grok-provider

Community SuperGrok / xAI OAuth provider for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) `0.1.5-rc.2`.

[简体中文](#简体中文) · [English](#english)

> Unofficial community project. Not affiliated with xAI or DeepSeek.

---

## English

Clean-room LLM adapter: in-process xAI OAuth (browser PKCE + device code), account model catalog, and streaming chat on the SuperGrok session proxy. It does **not** spawn the official Grok CLI.

| | |
|---|---|
| Package | `dsh-grok-provider` |
| Plugin id / name | `llm-grok` |
| Provider route | `grok` |
| Version | `2.0.0-alpha.0` |
| Host | DSH `0.1.5-rc.2` |
| Source | https://github.com/pd90506/dsh-grok-provider |
| Chat endpoint | `https://cli-chat-proxy.grok.com/v1` (OAuth Responses only) |

### Install (web profile)

From GitHub (tracks `main`):

```yaml
# profile composition / plugins — example
- github:pd90506/dsh-grok-provider#main
```

Or with the DSH plugin installer, depending on your profile layout:

```bash
# example: add the GitHub package to the web profile, then restart the host
# github:pd90506/dsh-grok-provider#main
```

Restart the DSH host after install. Host plugins are not hot-reloaded.

### Login

1. Open **Settings → Grok** (`llm-grok`).
2. **Browser login** (default): PKCE + loopback; if localhost cannot receive the redirect, paste the **full** redirect URL (must include matching `state`). Raw authorization codes are rejected.
3. **Device login**: for SSH / WSL / headless; approve the user code in a browser.
4. Optional: reuse `~/.grok/auth.json` **read-only**. This plugin never writes that file.

Tokens refresh automatically. Failed refresh marks you logged out.

### Models

After login the plugin fetches `GET /v1/models-v2` for the signed-in account. If discovery fails, it falls back to **`grok-4.6`**. Select provider `grok` and a catalog model in the usual DSH model picker.

Streaming covers text, reasoning, and tool-call argument deltas using the host `StreamChunk` vocabulary.

### Platforms

Linux, macOS, and Windows are in scope for OAuth (browser + device). Device login is the path when a browser cannot reach the host loopback.

### Non-goals (v1)

- Quota / usage dashboard
- xAI native tools (web/X search, image/video, code interpreter)
- Spawning `grok` CLI
- API-key chat to `api.x.ai`
- Depending on Pi (`@earendil-works/*`, `pi-xai-oauth`)
- npm publish (install from GitHub)

### License

MIT. See `LICENSE`.

---

## 简体中文

面向 DeepSeek Harness **`0.1.5-rc.2`** 的社区 SuperGrok / xAI OAuth 适配器。进程内 OAuth（浏览器 PKCE + device code）、账号模型目录、会话代理上流式对话。**不会**调用官方 `grok` CLI。

**非官方社区项目，与 xAI、DeepSeek 均无隶属关系。**

- 仓库：https://github.com/pd90506/dsh-grok-provider
- 插件名：`llm-grok`，路由：`grok`
- 安装：把 `github:pd90506/dsh-grok-provider#main` 加进 web profile 后**重启 host**
- 登录：Settings → Grok；浏览器登录或 device 登录；可只读复用 `~/.grok/auth.json`，不写回
- 模型：登录后拉 `/models-v2`，失败则 fallback `grok-4.6`

**第一版不做：** 额度面板、xAI 原生 search/生图等工具、spawn CLI、API Key 通道、依赖 Pi 运行时、npm 发布。
