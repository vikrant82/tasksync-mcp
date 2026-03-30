# opencode-tasksync

[OpenCode](https://opencode.ai) plugin for **[TaskSync](https://github.com/vikrant82/tasksync-mcp)** — human-in-the-loop feedback for AI coding agents.

Your agents call `get_feedback`, you reply via the web UI or Telegram, they keep working. Connections survive server restarts. Images appear natively in the conversation. Remote mode lets you respond from your phone.

## What You Get

- **`get_feedback` tool** — Blocks until you submit feedback via the TaskSync web UI or Telegram
- **`daemon` agent** — Pre-configured agent that maintains a continuous work → feedback → work loop
- **Agent augmentation** — Inject the feedback loop into your existing agents (`coder`, `ask`, `build`) with one config line
- **Unbreakable connections** — SSE with keepalives + automatic reconnection through server restarts and network blips (1s → 15s exponential backoff). The agent never sees transient errors.
- **Native images** — Attached images injected directly into the LLM conversation via `tool.execute.after` hook. No temp files.
- **Remote mode** — Get Telegram notifications with the agent's context when it's waiting. Quick-reply buttons or free-text responses, delivered straight back to the agent.
- **FYI updates** — When the agent works for 30+ seconds without asking for feedback, you get a status update on Telegram.

## Prerequisites

Start the TaskSync server:

```bash
npx tasksync-mcp-http
```

For remote mode, also set up a [Telegram bot](https://github.com/vikrant82/tasksync-mcp#remote-mode-telegram).

## Install

Add to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-tasksync"]
}
```

OpenCode auto-installs npm plugins at startup. Start OpenCode — a `daemon` agent is immediately available.

## Configure

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
| `overlayStyle` | `"full"` | Overlay detail: `"full"` (120 lines) or `"compact"` (50 lines) |

Environment overrides: `TASKSYNC_SERVER_URL`, `TASKSYNC_AUGMENT_AGENTS` (comma-separated), `TASKSYNC_OVERLAY_STYLE`.

## How It Works

1. **SSE transport** — `get_feedback` opens an SSE stream to the server. 30-second keepalives prevent idle timeouts. If the connection drops, the plugin retries silently with exponential backoff.
2. **Agent context capture** — The `experimental.text.complete` hook captures the agent's response text before tool execution. This text is forwarded to Telegram when remote mode is enabled.
3. **Native image injection** — The `tool.execute.after` hook injects feedback images as `FilePart` attachments on the tool result, so the LLM sees them directly.
4. **FYI timer** — If the agent writes text but doesn't call `get_feedback` within 30 seconds, a status update is sent to your notification channels.
5. **Config injection** — The plugin adds a `daemon` agent and optionally augments existing agents with the feedback loop protocol.

## Local Development

```bash
cd opencode-plugin
npm install && npm run build
```

Point to the local path in `opencode.json`:

```json
{
  "plugin": ["/path/to/tasksync-mcp/opencode-plugin"]
}
```

Rebuild with `npm run build` after changes, then restart OpenCode.

## Full Documentation

See the **[OpenCode Plugin Guide](https://github.com/vikrant82/tasksync-mcp/blob/main/docs/OPENCODE_PLUGIN.md)** for agent augmentation, overlay styles, remote mode setup, and troubleshooting.

## License

MIT
