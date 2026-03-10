# Suggested Commands

## Development
```bash
# Build TypeScript
npm run build

# Type-check only
npx tsc --noEmit

# Run tests
npx jest

# Run tests (watch mode)
npx jest --watch
```

## Running the Server
```bash
# Default — keepalive mode, no heartbeat (recommended)
TASKSYNC_LOG_LEVEL=debug TASKSYNC_LOG_FILE=tasksync.log node dist/index.js --port=3011 --ui-port=3457

# Legacy heartbeat mode (returns [WAITING] on timeout)
node dist/index.js --port=3011 --ui-port=3457 --heartbeat --timeout=230000

# Production (no debug logging)
node dist/index.js --port=3011 --ui-port=3457
```

## CLI Flags
| Flag | Default | Description |
|------|---------|-------------|
| `--port=N` | 3011 | MCP server port |
| `--ui-port=N` | 3457 | Web UI port |
| `--no-ui` | false | Disable web UI |
| `--heartbeat` | false | Enable [WAITING] timeout mode (legacy) |
| `--timeout=N` | 3600000 | Timeout in ms (only used with --heartbeat) |

## Environment Variables
| Var | Default | Description |
|-----|---------|-------------|
| `TASKSYNC_LOG_LEVEL` | info | Log level (debug/info/warn/error) |
| `TASKSYNC_LOG_FILE` | (none) | Log to file instead of stdout |

## Log Analysis
```bash
# View keepalive lifecycle
grep -E "keepalive\.(started|sent|stopped)" tasksync.log

# View feedback delivery
grep -E "feedback\.(waiting|return|wait\.)" tasksync.log

# View all events for a session
grep "SESSION_ID" tasksync.log
```
