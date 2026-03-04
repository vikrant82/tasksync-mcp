# TaskSync MCP Server

TaskSync is an MCP server focused on iterative human feedback loops for coding agents.

It provides:
- `get_feedback`: session-scoped blocking feedback queue (in-memory, non-persistent)

## Transport Model

TaskSync now runs as **Streamable HTTP MCP only**.

- MCP endpoint: `http://localhost:3011/mcp`
- Health endpoint: `http://localhost:3011/health`
- Feedback UI: `http://localhost:3456`

No `stdio` transport, no SSE transport, and no file-based feedback watcher/persistence path.

## Quick Start

```bash
git clone https://github.com/4regab/tasksync-mcp.git
cd tasksync-mcp
npm install
npm run build
node dist/index.js --port=3011 --ui-port=3456
```

TaskSync is feedback-only and does not use workspace path arguments.

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

Optional auth headers:

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

## CLI Options

- `--port=<n>`: MCP Streamable HTTP port (default `3011`)
- `--ui-port=<n>`: feedback UI port (default `3456`)
- `--timeout=<ms>`: `get_feedback` wait timeout (`0` means block indefinitely)
- `--no-ui`: disable embedded feedback UI

## Documentation

- `docs/API_SPEC.md`
- `docs/SESSION_WORKFLOW.md`
- `docs/http-api.openapi.yaml`
- `docs/examples/client-configs.md`
- `docs/examples/http-endpoints.curl.md`
- `docs/examples/multi-session-flow.curl.md`

## License

MIT
