Updated 2026-04-19.

## Integration Paths
1. MCP Server — Streamable HTTP MCP for VS Code Copilot, Claude Desktop, and other MCP clients
2. OpenCode Plugin — native plugin (`opencode-tasksync`) using REST + SSE against the same server

Both paths share the same `SessionManager`, persisted session-state store, feedback UI server, and notification channels.

## Current Module Layout
- `src/index.ts` — thin bootstrap/composition entrypoint
- `src/mcp-server.ts` — Express MCP app, `requestContext`, `/mcp` POST/GET/DELETE, per-session server creation, transport lifecycle, waiter cleanup, `/health`
- `src/feedback-handler.ts` — MCP tool registration for `get_feedback` and `check_interrupts`
- `src/ui-server.ts` — feedback dashboard, UI SSE, feedback REST endpoints, plugin session registration, `GET /api/interrupts/:sessionId`, `GET /api/stream/:sessionId`
- `src/session-manager.ts` — orchestration for live sessions, close/delete flows, auto-prune, state broadcasting; composes focused state managers
- `src/feedback-state.ts` — queued/urgent feedback, pending waiters, agent context, remote-enabled flag, history, feedback-state persistence
- `src/alias-state.ts` — manual/inferred aliases, client generations, active UI session, `resolveTargetSession`
- `src/session-state-store.ts` — persisted state in `.tasksync/session-state.json`
- `src/stream-event-store.ts` — transient MCP replay store
- `src/channels.ts` — notification channels and Telegram reply routing

## Session Types
- MCP sessions: created via MCP initialize; have `StreamableHTTPServerTransport` + `Server`
- Plugin sessions: created via UI/plugin REST/SSE paths; no MCP transport
- `StreamableSessionEntry` keeps `transport?` and `server?` optional so both share the same session model

## Feedback Flow
- Waiter pattern: `setWaiter()` -> `deliverFeedback()` or `clearPendingWaiter()`
- `get_feedback` priority: urgent queue -> queued feedback -> blocking wait
- Plugin SSE wait path uses the same urgent-first then queued-first semantics
- Pending waiters are runtime-only and are not restored from persisted state

## Persistence Boundaries
Persisted across restart:
- aliases
- client generations
- active UI session id
- feedback history
- queued feedback/images
- urgent feedback/images
- remote-enabled flag

Runtime only:
- pending waiters
- live transports/servers
- agent context text
- active SSE connections

## Invariants
- `SessionManager` remains the broadcasting/orchestration boundary via `events.onStateChange()`
- `FeedbackStateManager` owns feedback-state mutation/persistence semantics
- `AliasStateManager` owns alias/target-resolution state and active-session selection semantics
- The recent refactor stream intentionally preserved behavior: no new validation branches, schema changes, or fallback-order changes
