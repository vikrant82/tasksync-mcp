# MCP Client Config Examples

This project is now **remote MCP first** (Streamable HTTP transport).

## OpenCode Remote MCP (recommended)

OpenCode supports remote MCP servers with `type: "remote"` and `url`.

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

Optional headers example:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "tasksync": {
      "type": "remote",
      "url": "https://mcp.example.com/mcp",
      "enabled": true,
      "headers": {
        "Authorization": "Bearer MY_API_KEY"
      }
    }
  }
}
```

## Run TaskSync Server Locally (for remote URL target)

```bash
npm run build
node dist/index.js --port=3011 --ui-port=3456
```

Then point OpenCode to:

```text
http://localhost:3011/mcp
```

## OpenCode local command mode (supported, but not preferred)

If you still want OpenCode to launch the process itself:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "tasksync": {
      "type": "local",
      "command": [
        "node",
        "/home/chauv/.config/opencode/tasksync-mcp/dist/index.js",
        "--port=3011",
        "--ui-port=3456"
      ],
      "enabled": true
    }
  }
}
```

## VS Code Copilot MCP (`.vscode/mcp.json`)

TaskSync is remote MCP-first in this repo, so configure it with `url`.
Serena can remain local `stdio`.

```json
{
  "servers": {
    "tasksync-serena": {
      "type": "stdio",
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--context",
        "ide-assistant",
        "--project",
        "tasksync-mcp",
        "/home/chauv/.config/opencode/tasksync-mcp"
      ]
    },
    "tasksync": {
      "url": "http://localhost:3011/mcp"
    }
  },
  "inputs": []
}
```

After saving `mcp.json`, start servers from the file CodeLens and verify in command palette:

- `MCP: List Servers`

You should see both `tasksync-serena` and `tasksync` available.

## Notes

- MCP endpoint: `http://localhost:3011/mcp`
- Feedback UI: `http://localhost:3456`
- Session-specific UI route: `http://localhost:3456/session/<sessionId>`
- Feedback is session-scoped with minimal persisted local state
- After a server restart, clients should initialize a fresh MCP session rather than reusing an old session ID
