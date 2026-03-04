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

## Notes

- MCP endpoint: `http://localhost:3011/mcp`
- Feedback UI: `http://localhost:3456`
- Session-specific UI route: `http://localhost:3456/session/<sessionId>`
- Feedback is session-scoped and in-memory (non-persistent)
