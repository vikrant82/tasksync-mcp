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
- Sessions inactive for >4 hours (and not currently waiting) are auto-pruned every 5 minutes.

## Feedback UI Endpoints

- `GET /`
- `GET /session/:sessionId`
- `GET /feedback/history?sessionId=<id>`
- `POST /feedback` body: `{ "content": string, "sessionId"?: string }`
- `GET /sessions`
- `POST /sessions/default` body: `{ "sessionId": string }`
- `POST /sessions/active` body: `{ "sessionId": string }` (legacy alias)
- `POST /sessions/:sessionId/alias` body: `{ "alias": string }` (empty alias clears custom name)
- `POST /sessions/prune` — removes sessions inactive for >1 hour
- `DELETE /sessions/:sessionId`

`GET /sessions` response fields per session include:
- `sessionId`: canonical MCP session ID (human-readable, e.g., `opencode-1`)
- `alias`: optional display label (manual alias or inferred initialize metadata)
- `sessionUrl`, `createdAt`, `lastActivityAt`, `waitingForFeedback`, `waitStartedAt`, `hasQueuedFeedback`

`GET /feedback/history` returns:
- `sessionId`: normalized session ID used for the lookup
- `history`: array of submitted user feedback entries `{ role, content, createdAt }`

## CLI Flags

- `--port=<port>`: MCP Streamable HTTP port (default `3011`)
- `--ui-port=<port>`: feedback UI port (default `3456`)
- `--timeout=<ms>`: feedback wait timeout (`0` blocks forever)
- `--no-ui`: disable feedback UI

## Persistence Notes

- Local persisted state path: `.tasksync/session-state.json`
- Persisted state includes queued/latest feedback, bounded submitted feedback history, session metadata, alias metadata, and active UI session.
- Live transport objects, MCP server instances, waiter resolver closures, and replay-event history are not persisted to the session file.

## Feedback UI Notes

- On wide screens, the UI shows feedback composer/history on the left and sessions/settings in a right sidebar.
- The current session view includes latest feedback text plus submitted feedback history for that session.
