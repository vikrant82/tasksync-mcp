# Suggested Commands

Updated: 2026-03-27

## Development
```bash
# Build server
npm run build

# Build plugin
cd opencode-plugin && npx tsc

# Type-check only
npx tsc --noEmit

# Run tests
npx jest
```

## Running the Server
```bash
# Default — keepalive mode (recommended)
node dist/index.js --port=3011 --ui-port=3456

# With debug logging
TASKSYNC_LOG_LEVEL=debug TASKSYNC_LOG_FILE=tasksync.log node dist/index.js --port=3011 --ui-port=3456

# Legacy heartbeat mode (returns [WAITING] on timeout)
node dist/index.js --port=3011 --ui-port=3456 --heartbeat --timeout=230000
```

## CLI Flags (Server)
| Flag | Default | Description |
|------|---------|-------------|
| `--port=N` | 3011 | MCP server port |
| `--ui-port=N` | 3456 | Web UI + REST API port |
| `--no-ui` | false | Disable web UI |
| `--heartbeat` | false | Enable [WAITING] timeout mode (legacy) |
| `--timeout=N` | 3600000 | Timeout in ms (only with --heartbeat) |

## Environment Variables
| Var | Default | Description |
|-----|---------|-------------|
| `TASKSYNC_LOG_LEVEL` | info | Log level (debug/info/warn/error) |
| `TASKSYNC_LOG_FILE` | (none) | Log to file instead of stdout |
| `TASKSYNC_SERVER_URL` | http://localhost:3456 | Plugin: server URL |
| `TASKSYNC_AUGMENT_AGENTS` | (none) | Plugin: comma-separated agent names or * |
| `TASKSYNC_OVERLAY_STYLE` | full | Plugin: full or compact overlay |

## Plugin Testing
```bash
# Start server first
node dist/index.js

# Plugin is configured in ~/.config/opencode/opencode.json:
# "plugin": ["opencode-tasksync"]  or  "/path/to/opencode-plugin"
# "tasksync": { "serverUrl": "http://localhost:3456", "augmentAgents": ["ask", "build"] }

# Test plugin endpoint manually
curl -X POST http://localhost:3456/api/sessions -H 'Content-Type: application/json' -d '{"sessionId":"test-1"}'
curl -X POST http://localhost:3456/api/wait/test-1  # blocks until feedback submitted
```

## Log Analysis
```bash
# View keepalive lifecycle
grep -E "keepalive\.(started|sent|stopped)" tasksync.log

# View feedback delivery
grep -E "feedback\.(waiting|return|wait\.)" tasksync.log

# View all events for a session
grep "SESSION_ID" tasksync.log
```
