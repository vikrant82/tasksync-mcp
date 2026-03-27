# OpenCode Plugin Guide

The `opencode-tasksync` plugin integrates TaskSync directly into [OpenCode](https://opencode.ai) as a native plugin. It connects to the TaskSync server via REST and injects feedback loop behavior into your agents automatically.

## Prerequisites

Start the TaskSync server:

```bash
npx tasksync-mcp-http
```

Server starts on:
- MCP: `http://localhost:3011/mcp`
- Feedback UI: `http://localhost:3456`

## Installation

Add to your global OpenCode config (`~/.config/opencode/opencode.json`):

```json
{
  "plugin": ["opencode-tasksync"]
}
```

OpenCode auto-installs npm plugins at startup. No build step needed.

### Local Development

For development from source, build the plugin first:

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

Create `~/.tasksync/config.json` (global) or `.tasksync/config.json` (project-level):

```json
{
  "serverUrl": "http://localhost:3456",
  "augmentAgents": [],
  "overlayStyle": "full"
}
```

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `serverUrl` | `http://localhost:3456` | TaskSync server URL (UI port) |
| `augmentAgents` | `[]` | Which agents to augment with feedback loop |
| `overlayStyle` | `"full"` | Overlay style for augmented agents |

### Precedence

Configuration is merged with this priority (highest wins):

1. **Environment variables**
2. **Project** `.tasksync/config.json`
3. **Global** `~/.tasksync/config.json`
4. **Defaults**

### Environment Variables

| Variable | Maps to | Example |
|----------|---------|---------|
| `TASKSYNC_SERVER_URL` | `serverUrl` | `http://localhost:3456` |
| `TASKSYNC_AUGMENT_AGENTS` | `augmentAgents` | `coder,ask` or `*` |
| `TASKSYNC_OVERLAY_STYLE` | `overlayStyle` | `full` or `compact` |

## Agent Behavior

### Dedicated Daemon Agent

The plugin always creates a `daemon` agent with the complete TaskSync feedback loop protocol. This agent:

- Calls `get_feedback` at the end of every response
- Blocks until you submit feedback in the web UI
- Never exits the loop unless you say "stop", "end", "terminate", or "quit"
- Handles session bootstrap, pause/resume, and error recovery

Use it by selecting the `daemon` agent in OpenCode.

### Agent Augmentation

You can inject the feedback loop into existing agents (like `coder`, `ask`, `build`) so they also participate in the feedback loop.

**Examples:**

```json
{
  "augmentAgents": ["coder", "ask"]
}
```

| Value | Effect |
|-------|--------|
| `[]` | No augmentation (only `daemon` agent has the loop) |
| `["coder"]` | Augment only the `coder` agent |
| `["coder", "ask"]` | Augment specific agents |
| `["*"]` | Augment ALL agents (except `daemon`) |

### Overlay Styles

When augmenting existing agents, the plugin appends a "daemon overlay" to their prompt:

| Style | Lines | Description |
|-------|-------|-------------|
| `"full"` | ~120 | Complete protocol — same depth as the standalone daemon prompt |
| `"compact"` | ~50 | Condensed core rules only |

The `"full"` style is recommended for models that need explicit instructions. Use `"compact"` for capable models that follow instructions well with less prompting.

## How It Works

```
OpenCode Agent  ──get_feedback──►  Plugin  ──POST /api/wait/:sessionId──►  TaskSync Server
                                                                                  │
                                                                           Blocks until
                                                                           feedback submitted
                                                                                  │
OpenCode Agent  ◄──feedback text──  Plugin  ◄──JSON response────────────  TaskSync Server
```

1. Agent calls `get_feedback` (native OpenCode tool, no MCP prefix)
2. Plugin sends `POST /api/wait/:sessionId` to the TaskSync server
3. Request blocks until you submit feedback in the web UI
4. Plugin returns your feedback text to the agent
5. Agent processes feedback and calls `get_feedback` again

Sessions are auto-registered on first `get_feedback` call. Cleanup happens on `session.deleted` events.

## Limitations

- **No image support in responses**: OpenCode plugin tools return strings only. Images attached in the feedback UI are not delivered to the agent. (The MCP integration supports full `ImageContent` blocks.)
- **Server must be running**: The plugin connects to an external server. If the server is down, `get_feedback` calls will fail.
- **One server instance**: Multiple OpenCode instances share the same TaskSync server and feedback UI.

## Troubleshooting

**Plugin not loading**: Check `opencode.json` `plugin` array points to the correct path or npm package name.

**"Connection refused" errors**: Ensure the TaskSync server is running (`npx tasksync-mcp-http`).

**Agent not calling `get_feedback`**: Check that you're using the `daemon` agent, or that the agent is listed in `augmentAgents`.

**Feedback UI not opening**: The server opens the browser automatically. If blocked, navigate to `http://localhost:3456` manually.
