Updated: 2026-03-20

## MCP protocol/session-disconnect research (official sources)

Sources reviewed:
- modelcontextprotocol/modelcontextprotocol
  - docs/specification/2025-11-25/basic/transports.mdx (stable)
  - docs/specification/draft/basic/utilities/ping.mdx
  - seps/1699-support-sse-polling-via-server-side-disconnect.md (Final)
- modelcontextprotocol/typescript-sdk
  - packages/server/src/server/streamableHttp.ts
- NPM metadata for @modelcontextprotocol/sdk

## Key normative points (relevant to stale/disconnect logic)

1. Streamable HTTP session semantics
- Server MAY assign `MCP-Session-Id` at initialize response.
- Client MUST send session id on subsequent requests.
- Server MAY terminate session at any time; after termination server MUST return HTTP 404 for that session id.
- On 404 for session id, client MUST start new initialize flow (new session).
- Client SHOULD send DELETE when it no longer needs a session (server MAY 405).

2. SSE disconnect/polling semantics (critical)
- Server MAY close connection before final response after sending priming SSE event ID.
- Client SHOULD reconnect (poll) using Last-Event-ID.
- Server SHOULD send SSE `retry` value before closing, client MUST respect retry.
- Disconnection MAY occur anytime.
- Disconnection SHOULD NOT be interpreted as client cancellation.
- Client cancellation should be explicit (CancelledNotification).

3. Keepalive vs ping
- In Streamable HTTP, implementations SHOULD prefer transport-level SSE keepalive for idle maintenance.
- MCP `ping` remains protocol-level liveness signal and MAY be used.

4. SDK behavior (TypeScript SDK)
- `onsessionclosed` callback is invoked on DELETE handling (`handleDeleteRequest`).
- `close()` calls transport `onclose` and stream cleanup.
- Distinction exists between session close and transport/stream close in SDK docs/comments.
  - Session close is explicit lifecycle action.
  - Transport/stream closures can be per-connection and transient.

## Implications for tasksync stale/disconnect discovery

- A closed/disconnected HTTP stream is not sufficient evidence of dead session.
- Repeated abort/disconnect events can be normal polling/reconnect behavior.
- Strong "session closed" signal should come from explicit DELETE / session termination path.
- Stale should be derived from meaningful work/health activity windows, not merely any inbound request attempt.

## Version note
- Local project currently depends on `@modelcontextprotocol/sdk` ^1.17.0.
- Latest NPM observed in research: 1.27.1 (published 2026-02-24).
- There may be transport/lifecycle improvements in newer SDK versions worth evaluating separately.