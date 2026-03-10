# MCP Streaming, SSE, and Transport Patterns

## Overview
TaskSync uses the MCP Streamable HTTP transport (spec 2025-03-26) with SSE for server→client streaming.
The `get_feedback` tool creates long-lived POST requests that wait for human feedback.
The key challenge: keeping POST connections alive during long waits without consuming agent tokens.

## Architecture: Streamable HTTP Transport
- Single endpoint handles POST (tool calls), GET (SSE notification stream), DELETE (session termination)
- POST responses use SSE format when streaming: `text/event-stream` content type
- Session management via `Mcp-Session-Id` header (UUID, set on initialize response)
- Event replay support via `Last-Event-ID` / `Mcp-Session-Id` headers (GET stream only)

## SSE Keepalive — The Breakthrough (Implemented)
**Problem:** POST requests for `get_feedback` are long-lived (minutes to hours). Without activity:
- Proxies/load balancers drop idle connections at 60-300s
- Clients timeout and create new sessions instead of retrying
- Previous workaround: return `[WAITING]` text after short timeout → agent re-POSTs → wastes tokens, fills context

**Solution: SSE comment keepalive on POST stream**
- Server writes `: keepalive\n\n` (SSE comment) every 30s to the POST response stream
- SSE comments are spec-compliant and ignored by all SSE clients — transparent to MCP protocol
- Prevents idle connection drops from proxies, load balancers, and client HTTP stacks
- No token cost, no context bloat, no agent re-POST cycles

**Implementation details:**
- `KEEPALIVE_INTERVAL_MS = 30000` (30 seconds)
- Uses `requestContext` AsyncLocalStorage to pass Express `res` to the get_feedback handler
- Interval is cleared on: feedback received, timeout, connection close, write error
- Logging: `feedback.keepalive.started`, `.sent` (sampled every 10th), `.stopped` (with reason + totalSent)

**Validation results (tested with OpenCode 1.2.22):**
- 10-minute idle test: single POST held open, 22 keepalives sent, zero [WAITING], clean delivery ✅
- Previous 49-minute session analysis: keepalive eliminated connection drops entirely
- With 230s timeout: 10 unnecessary re-POST cycles during 38-min idle → with 1-hour timeout: would be 1 POST

## Configuration: --heartbeat Flag
- **Default (no flag):** `heartbeat=false` → `feedbackTimeout=0` → wait indefinitely. Keepalive keeps connection alive. `[WAITING]` is never returned.
- **Legacy mode:** `--heartbeat` → `feedbackTimeout` respects `--timeout=` or DEFAULT_TIMEOUT (1 hour). Returns `[WAITING]` on timeout.
- `DEFAULT_TIMEOUT = 3_600_000` (1 hour safety net, only used in heartbeat mode)

## Client Behavior Observations

### OpenCode (1.2.22)
- Does NOT re-call get_feedback after POST disconnect — creates new sessions instead
- With keepalive: single POST stays open, clean delivery
- tools/list called 3 times during MCP handshake (initialize sequence)

### VS Code Copilot (GitHub Copilot Chat)
- More resilient: re-calls get_feedback after [WAITING] returns
- Previously sustained 217 heartbeat cycles (~18 hours) via repeated re-POSTs
- High token consumption from repeated [WAITING] processing
- GET SSE streams show ~5-minute disconnect/reconnect cycles

### Common Patterns
- GET SSE notification streams disconnect/reconnect every ~5 minutes (Node HTTP agent / proxy behavior)
- SDK auto-reconnects GET streams but does NOT retry failed POST requests
- POST disconnects propagate as errors to agent; GET disconnects are handled transparently

## Agent Prompt Configuration
| File | [WAITING] | Use with |
|------|-----------|----------|
| `task-sync-agent-opencode.md` | ❌ No | Default (keepalive mode) |
| `task-sync-agent-copilot.md` | ❌ No | Default (keepalive mode) |
| `task-sync-agent-opencode-waiting.md` | ✅ Yes | `--heartbeat` mode |
| `task-sync-agent-copilot-waiting.md` | ✅ Yes | `--heartbeat` mode |

## Startup Commands
```bash
# Default — keepalive mode, no heartbeat
TASKSYNC_LOG_LEVEL=debug TASKSYNC_LOG_FILE=tasksync.log node dist/index.js --port=3011 --ui-port=3457

# Legacy heartbeat mode
node dist/index.js --port=3011 --ui-port=3457 --heartbeat --timeout=230000
```

## Key Log Events for Monitoring
| Event | Meaning |
|-------|---------|
| `feedback.waiting` | get_feedback call started; shows `heartbeat`, `timeoutMs` |
| `feedback.keepalive.started` | Keepalive interval active |
| `feedback.keepalive.sent` | Keepalive written (sampled every 10th) |
| `feedback.keepalive.stopped` | Interval cleared; `reason` + `totalSent` |
| `feedback.return.live` | Feedback delivered; `waitDurationMs`, `keepalivesSent` |
| `feedback.wait.timeout` | Timeout fired (heartbeat mode only); `keepalivesSent` |
| `feedback.wait.interrupted` | Connection closed during wait |

## Technical Notes
- Keepalive writes directly to Express `res` — bypasses MCP SDK transport abstraction
- Risk: if SDK changes how it owns response writes, keepalive could conflict
- SSE comments (`: keepalive\n\n`) are ignored by EventSource and all spec-compliant SSE clients
- Debug logging: HTML bodies replaced with `[HTML content omitted]`, response accumulation capped at 50KB, keepalive comments filtered from debug accumulator
