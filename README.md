# TaskSync MCP Server

TaskSync is an MCP server focused on iterative human feedback loops for coding agents.

It provides:
- `get_feedback`: session-scoped feedback wait with SSE keepalive to maintain long-lived connections
- **Image support**: paste, drag-drop, or attach images in the feedback UI — delivered to the agent as MCP `ImageContent` blocks
- **Markdown toolbar**: formatting buttons, keyboard shortcuts (Ctrl+B/I/K), Tab indentation, and auto-continue lists
- Optional heartbeat mode via `[WAITING]` responses for legacy/polling clients

## Transport Model

TaskSync runs as **Streamable HTTP MCP only**.

- MCP endpoint: `http://localhost:3011/mcp`
- Health endpoint: `http://localhost:3011/health`
- Feedback UI: `http://localhost:3456`

No `stdio` transport and no legacy file-watcher feedback path. TaskSync persists minimal session/feedback metadata locally.

## Quick Start

```bash
git clone https://github.com/4regab/tasksync-mcp.git
cd tasksync-mcp
npm install
npm run build
node dist/index.js --port=3011 --ui-port=3456
```

By default, `get_feedback` waits **indefinitely** for human feedback. The connection is kept alive by SSE comment keepalives (`: keepalive\n\n`) sent every 30 seconds, preventing proxy/client idle timeouts. No `[WAITING]` responses are returned unless heartbeat mode is explicitly enabled.

## SSE Keepalive

When `get_feedback` is called, the POST response stream stays open while waiting for human feedback. To prevent network intermediaries (proxies, load balancers, HTTP clients) from dropping the idle connection:

- The server writes SSE comment keepalives (`: keepalive\n\n`) every 30 seconds
- SSE comments are spec-compliant and transparently ignored by all MCP clients
- No token cost, no context bloat for the agent
- The connection stays alive until feedback is submitted or the client disconnects

This eliminates the previous pattern of repeated `[WAITING]` → re-POST cycles that consumed tokens and filled agent context windows.

## Image Support

The feedback UI supports sending images alongside text feedback. Images are delivered to the agent as MCP `ImageContent` blocks in the `get_feedback` tool response.

**How to attach images:**
- **Paste**: Copy an image and paste directly into the feedback textbox (Ctrl/Cmd+V)
- **Drag & drop**: Drag image files onto the textbox
- **File picker**: Click "Attach Image" to browse for files

**Limits:**
- Max 10 images per submission
- Max 10 MB per image
- Supported formats: PNG, JPEG, GIF, WebP, SVG

Images appear as thumbnails in the composer before sending, and in the conversation history after submission. Click any history thumbnail for a full-size lightbox view.

**MCP response format:**
When images are included, `get_feedback` returns mixed content blocks:
```json
{
  "content": [
    { "type": "text", "text": "user's text feedback" },
    { "type": "image", "data": "<base64>", "mimeType": "image/png" }
  ]
}
```

> **Note**: Client support for `ImageContent` varies. Claude Desktop handles images natively. OpenCode does not yet process `ImageContent` blocks from MCP tool results (as of late 2025).

## OpenCode Remote MCP Configuration

Reference: `https://opencode.ai/docs/mcp-servers/`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "tasksync": {
      "type": "remote",
      "url": "http://localhost:3011/mcp",
      "enabled": true
    }
  }
}
```

## VS Code Copilot Configuration

Add to `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "tasksync": {
      "url": "http://localhost:3011/mcp"
    }
  },
  "inputs": []
}
```

Or place in `~/.vscode/mcp.json` for global configuration. See `docs/examples/copilot-mcp.json` for reference.

## CLI Options

| Option | Default | Description |
|--------|---------|-------------|
| `--port=<n>` | `3011` | MCP Streamable HTTP port |
| `--ui-port=<n>` | `3456` | Feedback UI port |
| `--heartbeat` | *(flag, off)* | Boolean flag — include to enable legacy heartbeat mode. When enabled, returns `[WAITING]` text after timeout; agent must re-call `get_feedback`. When omitted (default), `get_feedback` waits indefinitely with SSE keepalive. |
| `--timeout=<ms>` | `3600000` | How long to wait (in ms) before returning `[WAITING]`. **Only effective when `--heartbeat` is present.** Ignored in default keepalive mode. |
| `--no-ui` | *(flag, off)* | Boolean flag — include to disable embedded feedback UI |

### Default mode (recommended)

```bash
node dist/index.js --port=3011 --ui-port=3456
```

`get_feedback` waits indefinitely with SSE keepalive. No `[WAITING]` is returned.

### Heartbeat mode (legacy)

```bash
node dist/index.js --port=3011 --ui-port=3456 --heartbeat --timeout=230000
```

`get_feedback` returns `[WAITING]` after the timeout, and the agent re-calls. Use the `-waiting` agent prompt variants with this mode.

## Agent Prompts

TaskSync includes agent prompt files for configuring the daemon loop behavior:

| Prompt File | Mode | Use with |
|-------------|------|----------|
| `task-sync-agent-opencode.md` | Default (keepalive) | OpenCode |
| `task-sync-agent-copilot.md` | Default (keepalive) | VS Code Copilot |
| `task-sync-agent-opencode-waiting.md` | Heartbeat | OpenCode + `--heartbeat` |
| `task-sync-agent-copilot-waiting.md` | Heartbeat | VS Code Copilot + `--heartbeat` |

## Persistence and Reconnect Behavior

- Feedback/session metadata is persisted locally under `.tasksync/session-state.json`.
- The session file stores minimal state only: latest/queued feedback, session metadata, aliases, and active UI session.
- Session IDs are human-readable: `{client-slug}-{generation}` (e.g., `opencode-1`, `copilot-3`), derived from the MCP client's name and a monotonic counter.
- Stale sessions (inactive >4 hours, not currently waiting) are auto-pruned every 5 minutes.
- Temporary stream drops may still recover through normal in-memory Streamable HTTP replay while the server process remains alive.
- Stale pre-restart `mcp-session-id` values are still invalid; restart continuity comes from a fresh initialize plus preserved feedback/session reassociation.

## Logging

- `TASKSYNC_LOG_LEVEL=debug|info|warn|error` (default: `info`)
- `TASKSYNC_LOG_FILE=<path>` — log to file instead of stdout
- Example: `TASKSYNC_LOG_LEVEL=debug TASKSYNC_LOG_FILE=tasksync.log node dist/index.js --port=3011 --ui-port=3457`

Key log events for monitoring keepalive:
- `feedback.keepalive.started` — keepalive interval activated
- `feedback.keepalive.sent` — keepalive written (sampled every 10th)
- `feedback.keepalive.stopped` — interval cleared, with `reason` and `totalSent`
- `feedback.delivered.to_waiter` — feedback delivered to waiting agent, with `waitDurationMs`

Session routing note: UI "default session" is the fallback target used only when `POST /feedback` omits `sessionId`.

## Documentation

- `docs/API_SPEC.md`
- `docs/SESSION_WORKFLOW.md`
- `docs/FEEDBACK_UI_GUIDE.md`
- `docs/http-api.openapi.yaml`
- `docs/examples/client-configs.md`
- `docs/examples/copilot-mcp.json`
- `docs/examples/http-endpoints.curl.md`
- `docs/examples/multi-session-flow.curl.md`

## License

MIT
