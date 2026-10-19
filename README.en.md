# DSH WorkBuddy Broadcast

English | [中文](./README.md)

Publish the WorkBuddy account already signed in on this machine as an **OpenAI-compatible HTTP service**, so other agent tools on the same machine — on Windows, inside WSL, or on macOS and Linux — can reuse its models.

## What it solves

[`dsh-workbuddy-connect`](https://github.com/corrinehu/dsh-workbuddy-connect) lets **DSH itself** use WorkBuddy's models. That capability belongs to DSH alone.

If you also run other agent tools — Codex, Claude Code, Cursor, or your own scripts — they cannot share that quota. This plugin exposes the WorkBuddy account through the standard OpenAI protocol, so any tool that accepts a custom OpenAI base URL can use it directly.

```
any agent tool
      │  http://127.0.0.1:18731/v1  (standard OpenAI protocol)
      ▼
┌─────────────────────────────────────────┐
│  DSH: dsh-workbuddy-broadcast           │
│    ├─ Bearer authentication              │
│    ├─ GET  /v1/models                   │
│    └─ POST /v1/chat/completions  (SSE)  │
└─────────────────────────────────────────┘
      │
      ▼
   WorkBuddy account (reads the App's own sign-in)
```

## Requirements

1. **DSH (DeepSeek Harness)** installed and working
2. The **WorkBuddy** desktop app installed and **signed in** (China edition)
3. The [`dsh-workbuddy-connect`](https://github.com/corrinehu/dsh-workbuddy-connect) plugin installed, with a version matching your DSH core

> Item 3 is a **runtime** dependency, not an install-time one. This plugin does not block installation when it is absent; instead the plugin enters a `missing-peer` state, does not listen, and says so on its settings page.

## Install

```sh
dsh plugin --profile <your profile> add dsh-workbuddy-broadcast
```

Restart DSH afterwards. A **WorkBuddy Broadcast** page appears under Settings.

## Usage

### 1. Get the endpoint and API key

Open **Settings → WorkBuddy Broadcast**. The page shows:

- **WSL endpoint**: `http://<vEthernet address>:18731/v1`
- **Local endpoint**: `http://localhost:18731/v1`
- **API key**: use the Copy button

On first activation the API key is **randomly generated** and not written to disk. To keep a stable value, type your own into the field and save.

### 2. Configure another tool

Any tool that supports a custom OpenAI-compatible endpoint works:

```text
Base URL : http://localhost:18731/v1
API Key  : <the one copied from the settings page>
Model    : deepseek-v4.1-flash
```

**Important**: this service is **streaming-only (SSE)**. Requests are forced to `stream: true`; there is no single-shot full response. A tool that only issues non-streaming requests cannot use it.

### 3. Using it from WSL

WSL cannot reach a Windows listener through `127.0.0.1` (in NAT mode that address is WSL itself), and Windows' vEthernet address changes, so a forwarding script is needed.

> **The script is not in the npm package.** It is only useful on Windows + WSL,
> so it lives in the repository instead of inflating every install. Download it
> from
> [`scripts/wb-bridge`](https://github.com/zk-wz/dsh-workbuddy-broadcast/blob/main/scripts/wb-bridge)
> (Raw), or fetch it directly inside WSL:

```sh
# inside WSL
mkdir -p ~/scripts ~/.local/bin
curl -fsSL https://raw.githubusercontent.com/zk-wz/dsh-workbuddy-broadcast/main/scripts/wb-bridge \
  -o ~/scripts/wb-bridge
chmod 755 ~/scripts/wb-bridge
ln -sfn ~/scripts/wb-bridge ~/.local/bin/wb-bridge
```

Then:

```sh
wb-bridge start     # start in the background (no boot autostart is registered)
wb-bridge status    # show status
wb-bridge stop      # stop
wb-bridge port 8080 # change the port while running
wb-bridge log       # recent log lines (in memory only, never written to disk)
wb-bridge help
```

Once running, tools inside WSL use `http://127.0.0.1:18731/v1`.

> **Both sides must agree on the port**: `wb-bridge` forwards its local port to the **same port number** on Windows. If you change the plugin's port, change `wb-bridge` too.

## Configuration

Editable from the plugin's native form in the plugin manager, or from the settings page:

| Field | Default | Meaning |
|---|---|---|
| `port` | `18731` | Listening port |
| `apiKey` | empty (generated) | Bearer token; only persisted once you set one |
| `allowLocal` | `true` | Also listen on `127.0.0.1` for tools running on Windows itself |

Changes take effect after a **DSH restart** (or a plugin reload).

## Supported models

The model list is fetched from WorkBuddy at startup, so it **follows what your account can actually use** and may differ between accounts. Query it any time:

```sh
curl -H "Authorization: Bearer <key>" http://localhost:18731/v1/models
```

If the live fetch fails, the plugin falls back to a built-in static list, which may not match your account.

### Reasoning effort

The standard `reasoning_effort` parameter is **passed through unchanged**. Supported levels vary by model; common ones:

| Model | Levels |
|---|---|
| `deepseek-v4.1-flash` | `low` / `high` / `max` (default `high`) |
| `kimi-k2.8-preview` | `low` / `high` / `max` |
| `glm-5.3` / `glm-5.3-flash` | `low` / `high` / `max` |
| `space-bunny` | `low` / `medium` / `high` / `xhigh` / `max` |
| `step-5-preview` | `low` / `medium` / `high` |

A few models (such as `glm-5.1`) **require** `reasoning_effort` to be sent explicitly; omitting it is rejected upstream.

## Security notes

- The **API key is stored in plain text** in your DSH profile's `cordis.patch.yml`, which is how DSH persists configuration. Keep that in mind if your config directory is readable by others.
- By default the plugin listens only on `127.0.0.1` and the WSL vEthernet adapter — **never on `0.0.0.0`** — so it is not exposed to your LAN by default.
- Set `allowLocal` to `false` to drop the loopback listener.
- The plugin reads WorkBuddy's own sign-in state and **never modifies or copies** its credential files. The decryption key exists only in memory.

## Limitations

- **Streaming (SSE) only**; non-streaming requests are not supported.
- Serves **only the currently signed-in** WorkBuddy account.
- Depends on the public exports of [`dsh-workbuddy-connect`](https://github.com/corrinehu/dsh-workbuddy-connect); an incompatible change there requires an update here.
- **WSL is optional**: without it the plugin degrades to a loopback-only listener. On Windows, tools then use `http://localhost:18731/v1`.

## Platform support

| Platform | Status | Notes |
|---|---|---|
| **Windows** | ✅ Full | Serves both Windows-side tools and WSL tools |
| **macOS** | ✅ Supported | Loopback only; credential decryption finds the app through Spotlight |
| **Linux / WSL** | ⚠️ Partial | Loopback only. If WorkBuddy stores its credential encrypted (`$wbEncrypted`), it **cannot be decrypted** — upstream [`dsh-workbuddy-connect`](https://github.com/corrinehu/dsh-workbuddy-connect) has the same limitation on Linux. Use an unencrypted credential file (`WORKBUDDY_AUTH_FILE`) instead |

The **WSL endpoint** (`http://<vEthernet address>:18731/v1`) exists only on Windows. Other platforms have no vEthernet adapter, so the plugin falls back to `127.0.0.1` and says so on its settings page.

## Disclaimer

This project is for **personal, same-machine use**: sharing your own signed-in WorkBuddy account with your own tools on your own machine.

- Do not share the API key with anyone
- Do not expose it as a public internet service
- Usage consumes **your own** WorkBuddy quota
- Follow WorkBuddy's terms of service

## License

MIT
