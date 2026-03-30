# TaskSync

Iterative human feedback loops for coding agents. TaskSync lets you pause an AI agent, provide feedback (text + images), and resume — keeping the human in the loop during long-running coding sessions.

## Install & Start

```bash
npx tasksync-mcp-http --port=3011 --ui-port=3456
```

- `--port` — MCP Streamable HTTP server (default: 3011)
- `--ui-port` — Feedback web UI (default: 3456)

## Two Integration Paths

| | **OpenCode Plugin** ⭐ | **MCP Server** |
|---|---|---|
| **Best for** | [OpenCode](https://opencode.ai) users | VS Code Copilot, Claude Desktop, any MCP client |
| **Setup** | Drop-in plugin, zero config | Configure MCP endpoint in your client |
| **Agent behavior** | Injects feedback loop into your existing agents | Manual — paste daemon prompt yourself |
| **Feedback tool** | `get_feedback` (native tool) | `tasksync_get_feedback` (MCP-prefixed) |
| **Image support** | Native injection via `tool.execute.after` hook | Full MCP `ImageContent` blocks |

### Why OpenCode users should prefer the plugin

The plugin injects feedback loop behavior automatically — a dedicated `daemon` agent, optional augmentation of your existing agents, and resilient SSE-based connections that survive server restarts without agent involvement. See the **[OpenCode Plugin Guide](docs/OPENCODE_PLUGIN.md)** for full details.

MCP is the universal fallback for non-OpenCode clients (VS Code Copilot, Claude Desktop, etc.).

## OpenCode Plugin

Add to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-tasksync"]
}
```

Start OpenCode — a `daemon` agent is automatically available with the feedback loop built in.

Optionally configure in `~/.tasksync/config.json`:

```json
{
  "serverUrl": "http://localhost:3456",
  "augmentAgents": ["ask", "build", "plan"],
  "overlayStyle": "full"
}
```

With `augmentAgents`, your existing agents gain feedback loop behavior without switching agents. See **[OpenCode Plugin Guide](docs/OPENCODE_PLUGIN.md)** for full details.

## MCP Server

Point your MCP client at `http://localhost:3011/mcp`:

### VS Code Copilot

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "tasksync": {
      "url": "http://localhost:3011/mcp"
    }
  }
}
```

### OpenCode (MCP mode)

If you prefer MCP over the plugin:

```json
{
  "mcp": {
    "tasksync": {
      "type": "remote",
      "url": "http://localhost:3011/mcp"
    }
  }
}
```

## How It Works

1. Agent calls `get_feedback` and blocks
2. Feedback UI opens in your browser (auto-launched)
3. You type feedback (+ optional images) and submit
4. Agent receives your response and continues working
5. Repeat — the agent stays in a feedback loop until you tell it to stop

## Feedback UI

The web UI (`http://localhost:3456`) provides:

- **Multi-session support**: Route feedback to different agent sessions
- **Image attachments**: Paste, drag-drop, or file-pick images (MCP returns native `ImageContent`; plugin injects native `FilePart` attachments)
- **Markdown toolbar**: Bold, italic, code, lists, headings with keyboard shortcuts
- **Live status**: See which sessions are waiting, idle, or have queued feedback
- **Desktop notifications**: Get alerted when an agent is waiting for you
- **Session management**: Rename, prune stale, delete sessions

See **[Feedback UI Guide](docs/FEEDBACK_UI_GUIDE.md)** for details.

## CLI Options

| Option | Default | Description |
|--------|---------|-------------|
| `--port=<n>` | `3011` | MCP Streamable HTTP port |
| `--ui-port=<n>` | `3456` | Feedback UI port |
| `--heartbeat` | off | Enable legacy `[WAITING]` timeout mode |
| `--timeout=<ms>` | `3600000` | Wait timeout (only with `--heartbeat`) |
| `--no-ui` | off | Disable embedded feedback UI |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `TASKSYNC_LOG_LEVEL` | `debug`, `info`, `warn`, `error` (default: `info`) |
| `TASKSYNC_LOG_FILE` | Path to log file (default: stderr) |

## Building from Source

```bash
git clone https://github.com/vikrant82/tasksync-mcp.git
cd tasksync-mcp
npm install && npm run build
node dist/index.js
```

## Agent Prompts

TaskSync includes ready-to-use daemon agent prompts in `prompts/`:

| File | Client |
|------|--------|
| `task-sync-agent-opencode.md` | OpenCode |
| `task-sync-agent-copilot.md` | VS Code Copilot |

The OpenCode plugin injects these automatically — no manual prompt configuration needed.

## Documentation

- [OpenCode Plugin Guide](docs/OPENCODE_PLUGIN.md) — Plugin setup, config, agent augmentation
- [API Specification](docs/API_SPEC.md) — MCP tools, HTTP endpoints, REST API
- [Session Workflow](docs/SESSION_WORKFLOW.md) — Session lifecycle and routing
- [Feedback UI Guide](docs/FEEDBACK_UI_GUIDE.md) — Web UI features and controls
- [Examples](docs/examples/) — Curl commands, client configs, multi-session flows

## License

MIT
