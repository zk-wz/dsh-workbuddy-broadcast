# DSH WorkBuddy Broadcast

[English](./README.en.md) | 中文

[![npm](https://img.shields.io/npm/v/dsh-workbuddy-broadcast.svg)](https://www.npmjs.com/package/dsh-workbuddy-broadcast)
[![license](https://img.shields.io/npm/l/dsh-workbuddy-broadcast.svg)](./LICENSE)

把本机已登录的 WorkBuddy 账号发布为一个 **OpenAI 兼容的 HTTP 服务**，供同一台机器上的其他 Agent 工具（WSL 内的、Windows 上的）复用它的模型。

## 它解决什么问题

`dsh-workbuddy-connect` 让 **DSH 自己**能用 WorkBuddy 的模型。但这个能力只属于 DSH。

如果你同时用别的 Agent 工具——Codex、Claude Code、Cursor、或者自己写的脚本——它们没法共用这份模型额度。本插件把 WorkBuddy 的账号能力以标准 OpenAI 协议暴露出来，那些工具只要支持「自定义 OpenAI Base URL」，就能直接接入。

```
任意 Agent 工具
      │  http://127.0.0.1:18731/v1  (标准 OpenAI 协议)
      ▼
┌─────────────────────────────────────────┐
│  DSH: dsh-workbuddy-broadcast           │
│    ├─ Bearer 鉴权                        │
│    ├─ GET  /v1/models                   │
│    └─ POST /v1/chat/completions  (SSE)  │
└─────────────────────────────────────────┘
      │
      ▼
   WorkBuddy 账号（读取 App 自身的登录态）
```

## 前置条件

1. 已安装 **DSH（DeepSeek Harness）** 并能正常运行
2. 已安装并**登录** WorkBuddy 桌面 App（国内版）
3. 已安装 [`dsh-workbuddy-connect`](https://github.com/corrinehu/dsh-workbuddy-connect) 插件，且版本与 DSH 内核匹配

> 第 3 条是**运行时依赖**，不是安装依赖。本插件不会在你安装时强制检查它；但缺少它时插件会进入 `missing-peer` 状态、不监听端口，并在设置页给出提示。

## 安装

```sh
dsh plugin --profile <你的 profile> add dsh-workbuddy-broadcast
```

装完后重启 DSH，在**设置**里会多出一个「WorkBuddy 广播」页面。

## 使用

### 1. 拿到端点与 API Key

打开 **设置 → WorkBuddy 广播**，页面会显示：

- **WSL 端点**：`http://<vEthernet 地址>:18731/v1`
- **本机端点**：`http://localhost:18731/v1`
- **API Key**：点「复制」即可

首次启用时 API Key 是**随机生成**的（不写盘）。想固定下来，就在页面的输入框里填一个自己的值并保存。

### 2. 在别的工具里配置

任何支持「自定义 OpenAI 兼容端点」的工具都可以：

```text
Base URL : http://localhost:18731/v1
API Key  : <设置页里复制的那个>
Model    : deepseek-v4.1-flash
```

**重要**：本服务**只支持流式（SSE）**。请求会强制 `stream: true`，不支持一次性返回完整响应。如果你的工具只做非流式调用，它无法使用本服务。

### 3. 在 WSL 里使用

WSL 无法通过 `127.0.0.1` 访问 Windows 上的监听端口（NAT 模式下 `127.0.0.1` 指向 WSL 自己），而 Windows 的 vEthernet 地址会变化，因此需要一个转发脚本。

把仓库里的 [`scripts/wb-bridge`](./scripts/wb-bridge) 复制到 WSL：

```sh
# 在 WSL 内
mkdir -p ~/scripts ~/.local/bin
cp wb-bridge ~/scripts/wb-bridge
chmod 755 ~/scripts/wb-bridge
ln -sfn ~/scripts/wb-bridge ~/.local/bin/wb-bridge
```

然后：

```sh
wb-bridge start     # 后台启动（不注册开机自启）
wb-bridge status    # 查看状态
wb-bridge stop      # 停止
wb-bridge port 8080 # 运行中改端口
wb-bridge log       # 查看最近日志（仅内存，不落盘）
wb-bridge help
```

启动后，WSL 里的工具用 `http://127.0.0.1:18731/v1` 即可。

> **端口必须两边一致**：WSL 侧的 `wb-bridge` 把本地端口转发到 Windows 的**同一个端口号**。如果你改了插件端口，`wb-bridge` 也要跟着改。

## 配置项

在插件管理页的原生表单，或设置页里都能改：

| 项 | 默认值 | 说明 |
|---|---|---|
| `port` | `18731` | 监听端口 |
| `apiKey` | 空（随机生成） | Bearer token；填了才会持久化 |
| `allowLocal` | `true` | 是否额外监听 `127.0.0.1`，供 Windows 本机工具使用 |

改完需要**重启 DSH**（或重新加载插件）才生效。

## 支持的模型

模型列表在启动时从 WorkBuddy 实时拉取，因此**跟随你账号的实际可用集合**，不同账号可能不同。可随时查询：

```sh
curl -H "Authorization: Bearer <key>" http://localhost:18731/v1/models
```

若实时拉取失败，会退回插件内置的静态列表（可能与你账号的实际可用集合有出入）。

### 推理强度

支持标准的 `reasoning_effort` 参数，会**原样透传**给上游。各模型支持的档位不同，常见的：

| 模型 | 支持档位 |
|---|---|
| `deepseek-v4.1-flash` | `low` / `high` / `max`（默认 `high`） |
| `kimi-k2.8-preview` | `low` / `high` / `max` |
| `glm-5.3` / `glm-5.3-flash` | `low` / `high` / `max` |
| `space-bunny` | `low` / `medium` / `high` / `xhigh` / `max` |
| `step-5-preview` | `low` / `medium` / `high` |

少数模型（如 `glm-5.1`）**要求必须显式传** `reasoning_effort`，不传会被上游拒绝。

## 安全说明

- **API Key 会以明文形式**保存在你的 DSH profile 的 `cordis.patch.yml` 里（这是 DSH 配置持久化机制决定的）。如果你的配置目录有被他人读取的风险，请留意。
- 默认只监听 `127.0.0.1` 与 WSL 的 vEthernet 网卡，**不监听 `0.0.0.0`**，因此默认不在局域网内暴露。
- 想关闭本机监听，把 `allowLocal` 设为 `false`。
- 本插件读取的是 WorkBuddy App 自身的登录态，**不修改、不复制**它的凭据文件。凭据解密用的密钥只在内存中存在。

## 限制

- **只支持流式（SSE）**，不支持非流式。
- 只能服务**当前登录的那一个** WorkBuddy 账号。
- 依赖上游 `dsh-workbuddy-connect` 的公开导出。若该插件发生不兼容改动，本插件需要同步更新。
- 仅支持 Windows。**没装 WSL 也能用**：插件会自动降级为只监听本机地址，设置页会说明未检测到 WSL 网卡。此时 Windows 上的工具用 `http://localhost:18731/v1` 即可。

## 免责声明

本项目仅用于**个人本机使用**：把你自己已登录的 WorkBuddy 账号能力共享给你自己机器上的其他工具。

- 请勿把 API Key 分享给他人
- 请勿将它部署为对公网开放的服务
- 使用本插件消耗的是**你自己的** WorkBuddy 额度
- 请遵守 WorkBuddy 的服务条款

## 许可

MIT
