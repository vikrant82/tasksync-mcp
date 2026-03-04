# TaskSync MCP API Spec

## Overview

- Server name: `tasksync-server`
- Version: `1.0.0`
- Transport: Streamable HTTP MCP
- Feedback storage: in-memory, session-scoped, non-persistent

## MCP Tools

### `get_feedback`

Waits for feedback text for the current MCP session.

Behavior:
- If queued feedback exists for the session, returns immediately.
- Otherwise blocks until new feedback arrives (or timeout if configured).
- Timeout mode (`--timeout>0`) returns:
  - `[WAITING] No new feedback yet. Call get_feedback again to continue waiting.`
- Optional legacy args `path`, `head`, `tail` are accepted for compatibility.
  - `path` is ignored.
  - `head`/`tail` trim returned text lines.

## MCP HTTP Endpoints

- `POST /mcp`
- `GET /mcp`
- `DELETE /mcp`
- `GET /health`

Session semantics:
- Client initializes without `mcp-session-id`.
- Server issues and tracks session id.
- Client sends `mcp-session-id` on subsequent requests.

## Feedback UI Endpoints

- `GET /`
- `GET /session/:sessionId`
- `GET /feedback?sessionId=<id>`
- `POST /feedback` body: `{ "content": string, "sessionId"?: string }`
- `GET /sessions`
- `POST /sessions/active` body: `{ "sessionId": string }`
- `DELETE /sessions/:sessionId`

## CLI Flags

- `--port=<port>`: MCP Streamable HTTP port (default `3011`)
- `--ui-port=<port>`: feedback UI port (default `3456`)
- `--timeout=<ms>`: feedback wait timeout (`0` blocks forever)
- `--no-ui`: disable feedback UI
