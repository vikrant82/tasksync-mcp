# MCP Transport, Streaming & Session Protocol

Updated: 2026-03-27 (consolidated from mcp_streaming_patterns + mcp_session_lifecycle_research)

## Streamable HTTP Transport (MCP Spec 2025-03-26)
- Single endpoint: POST (tool calls), GET (SSE notification stream), DELETE (session termination)
- Session via `Mcp-Session-Id` header (server assigns on initialize)
- POST responses use SSE format when streaming (`text/event-stream`)
- Event replay support via `Last-Event-ID` / `Mcp-Session-Id` (GET stream only)

## SSE Keepalive Solution
**Problem:** POST requests for `get_feedback` are long-lived (minutes to hours). Proxies drop idle connections at 60-300s.

**Solution:** SSE comment keepalive on POST stream
- Server writes `: keepalive\n\n` every 30s (`KEEPALIVE_INTERVAL_MS`)
- SSE comments are spec-compliant, ignored by all SSE clients — transparent to MCP
- No token cost, no context bloat, no agent re-POST cycles
- Uses `requestContext` AsyncLocalStorage to pass Express `res` to handler
- Cleared on: feedback received, timeout, connection close, write error

## Configuration
- **Default (no flag):** wait indefinitely with keepalive. No `[WAITING]`.
- **`--heartbeat`:** returns `[WAITING]` on timeout (`--timeout=` or 1h default). Legacy mode.
- `DEFAULT_TIMEOUT = 3_600_000` (1 hour, only used in heartbeat mode)

## MCP Protocol Normative Points
- Server MAY terminate session at any time → returns 404 for that session ID
- Client SHOULD send DELETE when session no longer needed
- **Disconnection SHOULD NOT be interpreted as client cancellation** (critical for stale detection)
- Client cancellation should be explicit (CancelledNotification)
- Implementations SHOULD prefer transport-level SSE keepalive for idle maintenance

## Client Behaviors
- **OpenCode:** Does NOT re-call get_feedback after POST disconnect — creates new sessions instead
- **VS Code Copilot:** More resilient, re-calls after [WAITING]. GET SSE streams ~5-minute reconnect cycles.
- **General:** SDK auto-reconnects GET streams but does NOT retry failed POST requests

## SDK Notes
- Local dependency: `@modelcontextprotocol/sdk` ^1.17.0
- `onsessionclosed` callback invoked on DELETE handling
- Distinction: session close (explicit lifecycle) vs transport/stream close (transient, per-connection)

## Agent Prompt Variants
| File | [WAITING] | Use with |
|------|-----------|----------|
| `task-sync-agent-opencode.md` | No | Default (keepalive) |
| `task-sync-agent-copilot.md` | No | Default (keepalive) |
| `-waiting.md` variants | Yes | `--heartbeat` mode |

## Key Log Events
| Event | Meaning |
|-------|---------|
| `feedback.waiting` | get_feedback started |
| `feedback.keepalive.started/sent/stopped` | Keepalive lifecycle |
| `feedback.return.live` | Feedback delivered |
| `feedback.wait.timeout` | Timeout (heartbeat mode) |
| `feedback.wait.interrupted` | Connection closed |
