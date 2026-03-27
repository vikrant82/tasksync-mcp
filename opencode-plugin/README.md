# opencode-tasksync

OpenCode plugin for [TaskSync](https://github.com/vikrant82/tasksync-mcp) — adds a persistent daemon feedback loop to your AI coding agents.

## What it does

- Adds a `get_feedback` tool that blocks until you submit feedback via the TaskSync web UI
- Injects a **daemon agent** that maintains a continuous work-feedback loop
- Optionally augments your existing agents (ask, build, etc.) with the same feedback protocol

## Prerequisites

You need a running TaskSync server. Install and start it:

```bash
npx tasksync-mcp
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
  "augmentAgents": ["ask", "build"],
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

The plugin connects to your TaskSync server via REST:

1. **`get_feedback` tool** — Long-polls `POST /api/wait/:sessionId` until feedback is submitted
2. **Config hook** — Injects a `daemon` agent + augments specified agents
3. **Event hook** — Cleans up sessions on deletion

The daemon agent prompt enforces a mandatory feedback loop: every response must end with a `get_feedback` call, creating a persistent work session.

## License

MIT
