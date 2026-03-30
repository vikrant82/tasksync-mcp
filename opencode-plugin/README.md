# opencode-tasksync

OpenCode plugin for [TaskSync](https://github.com/vikrant82/tasksync-mcp) — adds a persistent daemon feedback loop to your AI coding agents.

## Why use this instead of MCP?

With MCP, you get a tool but agents don't know to use it — you'd have to paste daemon prompts into each agent manually. This plugin **injects feedback loop behavior automatically**: a dedicated `daemon` agent plus optional augmentation of your existing agents (`ask`, `build`, `plan`). Your agents start calling `get_feedback` between tasks with zero prompt editing.

## What it does

- Adds a `get_feedback` tool that blocks until you submit feedback via the TaskSync web UI
- Injects a **daemon agent** that maintains a continuous work-feedback loop
- Optionally augments your existing agents (ask, build, etc.) with the same feedback protocol
- **Session resiliency** — SSE keepalives prevent idle timeouts, and the plugin silently reconnects through server restarts with exponential backoff. Agents never see transient errors.
- **Remote mode** — When enabled, the plugin sends the agent's current context to the server, which forwards it as a Telegram notification. Reply from your phone — the agent gets your feedback instantly.

## Prerequisites

You need a running TaskSync server. Install and start it:

```bash
npx tasksync-mcp-http --port=3011 --ui-port=3456
```

This starts the MCP server (port 3011) and web UI (port 3456).

## Installation

Add to your `opencode.json`:

```json
{
  "plugin": ["opencode-tasksync"]
}
```

That's it. OpenCode auto-installs npm plugins at startup.

### Local development

For development from source:

```bash
cd opencode-plugin
npm install && npm run build
```

Then point to the local path in `opencode.json`:

```json
{
  "plugin": ["/path/to/tasksync-mcp/opencode-plugin"]
}
```

Rebuild with `npm run build` after changes, then restart OpenCode.

## Configuration

Create `~/.tasksync/config.json` (global) or `.tasksync/config.json` (project):

```json
{
  "serverUrl": "http://localhost:3456",
  "augmentAgents": ["ask", "build", "plan"],
  "overlayStyle": "full"
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `serverUrl` | `http://localhost:3456` | TaskSync server URL |
| `augmentAgents` | `[]` | Agents to augment with feedback loop (`["*"]` for all) |
| `overlayStyle` | `"full"` | Overlay detail: `"full"` or `"compact"` |

Environment variable overrides: `TASKSYNC_SERVER_URL`, `TASKSYNC_AUGMENT_AGENTS` (comma-separated), `TASKSYNC_OVERLAY_STYLE`.

## How it works

The plugin connects to your TaskSync server via SSE (Server-Sent Events):

1. **`get_feedback` tool** — Opens an SSE stream to `GET /api/stream/:sessionId`. The server sends 30-second keepalives to prevent idle timeouts. When feedback arrives, it's delivered as an SSE event and the stream closes. If the connection drops (server restart, network glitch), the plugin automatically reconnects with exponential backoff (1s → 2s → 4s → … → 15s cap) — the agent never sees the interruption.
2. **Config hook** — Injects a `daemon` agent + augments specified agents
3. **Event hook** — Cleans up sessions on deletion

The daemon agent prompt enforces a mandatory feedback loop: every response must end with a `get_feedback` call, creating a persistent work session.

## License

MIT
