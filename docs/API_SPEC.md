# TaskSync MCP API Spec

## Overview

- Server name: `tasksync-server`
- Version: `1.0.0`
- Transport: Streamable HTTP MCP
- Feedback storage: session-scoped, file-backed minimal metadata

## MCP Tools

### `get_feedback`

Waits for feedback text for the current MCP session.

Behavior:
- If queued feedback exists for the session, returns immediately.
- Otherwise blocks until new feedback arrives.
- Default: waits indefinitely with SSE keepalive (`: keepalive\n\n` every 30s).
- Heartbeat mode (`--heartbeat`): returns `[WAITING]` on timeout (`--timeout=<ms>`).

Response format:
- Text-only feedback: `{ content: [{ type: "text", text: "..." }] }`
- With images: `{ content: [{ type: "text", text: "..." }, { type: "image", data: "<base64>", mimeType: "image/png" }, ...] }`
- Images are returned as MCP `ImageContent` blocks per the MCP specification.
- Image-only submissions (no text) omit the text block.

## MCP HTTP Endpoints

- `POST /mcp`
- `GET /mcp`
- `DELETE /mcp`
- `GET /health`

Session semantics:
- Client initializes without `mcp-session-id`.
- Server issues a human-readable session ID (e.g., `opencode-1`, `copilot-3`) derived from the client name and a monotonic counter.
- Client sends `mcp-session-id` on subsequent requests.
- Temporary stream reconnects can recover while the server process remains alive.
- Stale session IDs from before a server restart are still rejected; continuity is provided via fresh initialize plus reassociated persisted state.
- Auto-prune is configurable via UI settings ("Auto prune after" dropdown, default: Never/disabled). When enabled, inactive sessions (not currently waiting) are pruned every minute.

## Feedback UI Endpoints

- `GET /`
- `GET /session/:sessionId`
- `GET /feedback/history?sessionId=<id>`
- `POST /feedback` body: `{ "content": string, "images"?: [{ "data": string, "mimeType": string }], "sessionId"?: string }`
- `GET /sessions`
- `POST /sessions/default` body: `{ "sessionId": string }`
- `POST /sessions/active` body: `{ "sessionId": string }` (legacy alias)
- `POST /sessions/:sessionId/alias` body: `{ "alias": string }` (empty alias clears custom name)
- `POST /sessions/prune` — removes sessions inactive for >30 minutes
- `DELETE /sessions/:sessionId`

## Plugin REST API

These endpoints support external clients (e.g., the OpenCode plugin) that connect via HTTP instead of MCP.

### `POST /api/sessions`

Register an external session.

Request body:
```json
{ "sessionId": "my-session-1", "alias": "My Agent" }
```

Response:
```json
{ "ok": true, "sessionId": "my-session-1" }
```

Idempotent — returns ok if session already exists. Creates a session without MCP transport.

### `POST /api/wait/:sessionId`

Long-poll for feedback. Blocks until feedback is submitted or client disconnects.

Auto-registers the session if it doesn't exist.

Response (feedback received):
```json
{ "type": "feedback", "content": "user's feedback text", "images": [] }
```

Response (session closed):
```json
{ "type": "closed", "reason": "Session deleted" }
```

Behavior:
- If queued feedback exists, returns immediately
- Otherwise blocks until feedback is submitted via the web UI
- Client abort (e.g., `AbortController.abort()`) cancels the wait cleanly
- No keepalive needed (designed for localhost use)

### `POST /api/context/:sessionId`

Send agent context (assistant's last message) for display in the UI and remote notifications.

Request body:
```json
{ "context": "The agent's latest response text..." }
```

Response:
```json
{ "ok": true }
```

Called by the plugin before opening the SSE stream to deliver agent context without HTTP header size limits.

### `GET /api/stream/:sessionId`

SSE stream for receiving feedback. The plugin connects here after sending context via `POST /api/context/:sessionId`.

Auto-registers the session if it doesn't exist.

SSE events:
- `event: feedback` — `{ "type": "feedback", "content": "...", "images": [...] }`
- `event: closed` — `{ "type": "closed", "reason": "..." }`
- `event: error` — `{ "type": "error", "message": "..." }`
- SSE comments (`: keepalive`) every 30 seconds to prevent idle timeouts

### `POST /api/status/:sessionId`

Send FYI status notification to remote channels (Telegram). Only works when remote mode is enabled for the session.

`GET /sessions` response fields per session include:
- `sessionId`: canonical MCP session ID (human-readable, e.g., `opencode-1`)
- `alias`: optional display label (manual alias or inferred initialize metadata)
- `sessionUrl`, `createdAt`, `lastActivityAt`, `waitingForFeedback`, `waitStartedAt`, `hasQueuedFeedback`

`GET /feedback/history` returns:
- `sessionId`: normalized session ID used for the lookup
- `history`: array of submitted user feedback entries `{ role, content, createdAt, images? }`
  - `images` (optional): array of `{ data: string (base64), mimeType: string }` when images were attached

## CLI Flags

- `--port=<port>`: MCP Streamable HTTP port (default `3011`)
- `--ui-port=<port>`: feedback UI port (default `3456`)
- `--timeout=<ms>`: feedback wait timeout (`0` blocks forever)
- `--no-ui`: disable feedback UI

## Persistence Notes

- Local persisted state path: `.tasksync/session-state.json`
- Persisted state includes queued/latest feedback, bounded submitted feedback history (including image attachments), session metadata, alias metadata, and active UI session.
- Live transport objects, MCP server instances, waiter resolver closures, and replay-event history are not persisted to the session file.

## Feedback UI Notes

- On wide screens, the UI shows feedback composer/history on the left and sessions/settings in a right sidebar.
- The current session view includes latest feedback text plus submitted feedback history for that session.
- Image attachments: paste, drag-drop, or file picker. Max 10 images, 10 MB each. Supported: PNG, JPEG, GIF, WebP, SVG.
- Images are base64-encoded in the browser and sent in the `images` array of `POST /feedback`.
- Express JSON body limit is 50 MB to accommodate base64 image payloads.
