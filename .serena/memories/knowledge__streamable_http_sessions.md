# Streamable HTTP Session Management

## Transport Model
- Single endpoint (default /mcp) handles POST, GET, DELETE
- Sessions identified by `Mcp-Session-Id` header (UUID)
- Session state persisted in `.tasksync/session-state.json`
- GET SSE stream for server→client notifications (reconnectable via Last-Event-ID)
- POST SSE stream for tool call responses (kept alive by SSE keepalive)

## Session Lifecycle
1. Client sends POST `initialize` → server returns Mcp-Session-Id
2. Client sends GET to subscribe to notification stream
3. Client sends POST `tools/call` for each tool invocation
4. GET stream may disconnect/reconnect (~5 min cycles, auto-handled by SDK)
5. POST for get_feedback is long-lived: stays open with keepalive until feedback arrives
6. Session ends when client sends DELETE or connection drops permanently

## Connection Resilience
- **GET stream:** SDK auto-reconnects; transparent to agent
- **POST stream:** Kept alive by SSE comment keepalive (`: keepalive\n\n` every 30s)
- **Failure modes:** POST disconnect → error propagates to agent (SDK does NOT retry POST)
- **Default mode:** No timeout, no [WAITING] — POST stays open indefinitely
- **Heartbeat mode (--heartbeat):** Timeout fires → [WAITING] returned → agent re-POSTs

## Session State Store
- File-based: `.tasksync/session-state.json`
- Stores feedback text + pending waiter references per sessionId
- Pruning: sessions not accessed for >24h are cleaned up
- Structure: `{ sessions: { [id]: { feedback, waitingForFeedback, ... } } }`

## Event Replay
- InMemoryStreamEventStore tracks SSE events with sequential IDs
- Supports Last-Event-ID for GET stream resumption
- POST response events are NOT resumable (no standard mechanism)
