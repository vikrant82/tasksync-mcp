# TaskSync Architecture

Updated 2026-03-27.

## Monorepo Structure

Three packages in `packages/` with npm workspaces:

### `@tasksync/core` (packages/core/)
Shared foundation — no transport dependencies.

- **SessionManager** (`session-manager.ts`): Transport-agnostic session lifecycle. Constructor takes `SessionStateStore` + `SessionManagerEvents` ({onStateChange, onLog}). `SessionEntry` has optional `close?()` callback (no transport/server fields). Key methods: `createSession`, `closeSession`, `deleteSession`, `setWaiter`, `clearPendingWaiter`, `deliverFeedback`, `consumeQueuedFeedback`, `appendHistory`, `pruneStale`, `manualPrune`, `hydrateFromStore`, `initialize`, `shutdown`. All mutating methods call `this.events.onStateChange()` internally.
- **SessionStateStore** (`session-state-store.ts`): File-backed persistence in `.tasksync/session-state.json`. Stores feedback, session metadata, aliases, active UI session, settings.
- **FeedbackUIServer** (`feedback-ui-server.ts`): Standalone Express server for web UI. Constructor: `(sessionManager, logger, { port, openBrowser? })`. Routes: GET `/`, `/session/:id` (HTML), GET `/events` (SSE), GET `/feedback/history`, `/sessions`, POST `/feedback`, session management routes. Has `broadcastState()`, `buildStatePayload()`, `start()`, `stop()`.
- **Logger** (`logging.ts`): `createLogger(options)` factory with `Logger` interface. Supports console + file output, log level filtering.
- **Feedback HTML** (`feedback-html*.ts`): Complete HTML/CSS/JS templates for web UI.
- Barrel exports in `index.ts`.

### `tasksync-mcp` (packages/mcp/)
MCP server entry point. Depends on `@tasksync/core` + `@modelcontextprotocol/sdk`.

- Imports core components, adds MCP-specific transport logic
- `McpSessionInfo` type: `{ transport: StreamableHTTPServerTransport, server: Server }` — tracked in separate `mcpSessions` Map alongside core SessionManager
- MCP tool registration: `list_tools` (get_feedback) + `call_tool` handler with SSE keepalive
- `attachPendingWaiterCleanup` for request abort/close handling
- `inferAliasFromInitializeBody`, `slugifyForSessionId` — MCP protocol helpers
- `stream-event-store.ts`: MCP-specific transient SSE replay
- Debug logging: request/response pretty-printing, body truncation
- CLI args: `--port=3011`, `--ui-port=3456`, `--no-ui`, `--heartbeat`, `--timeout=`
- Env vars: `TASKSYNC_LOG_LEVEL`, `TASKSYNC_LOG_FILE`

### `opencode-tasksync` (packages/opencode-plugin/)
OpenCode plugin entry point. Depends on `@tasksync/core` + `@opencode-ai/plugin`.

- Default export: `Plugin` async function
- Initializes SessionManager + FeedbackUIServer (port 4596 default)
- `get_feedback` tool: checks queued feedback, creates `Promise.withResolvers<PendingFeedbackResult>` waiter, registers with SessionManager, listens to `context.abort` for cleanup
- `event` hook: `session.deleted` → `sessionManager.deleteSession()`
- `config` hook: injects `daemon` agent with full daemon loop prompt (from `daemon-prompt.ts`)
- Env vars: `TASKSYNC_UI_PORT`, `TASKSYNC_NO_BROWSER`, `TASKSYNC_LOG_LEVEL`, `TASKSYNC_LOG_FILE`
- Limitation: tool returns string only (no image content blocks — OpenCode tool API constraint)

## Feedback Flow (shared)

1. Agent calls `get_feedback` (MCP tool or plugin tool)
2. Tool checks `sessionManager.consumeQueuedFeedback()` — if queued, returns immediately
3. Otherwise creates a waiter promise, registers via `sessionManager.setWaiter()`
4. Waiter blocks until user submits feedback via web UI POST `/feedback`
5. `sessionManager.deliverFeedback()` resolves the waiter (or queues if no active waiter)
6. Result returned: MCP gets `{content: [TextContent, ...ImageContent]}`, plugin gets `string`

### MCP-specific additions
- SSE keepalive: `: keepalive\n\n` every 30s on POST response stream
- Timeout racing (configurable via `--timeout=` or `DEFAULT_TIMEOUT=1h`)
- Request abort cleanup via `attachPendingWaiterCleanup`

### Plugin-specific additions
- `context.abort` AbortSignal for cancellation cleanup
- No keepalive needed — OpenCode manages tool call lifecycle natively

## Key Invariants

1. **SessionManager owns all state broadcasting** via `events.onStateChange()`. Callers must NOT also broadcast.
2. **`appendHistory` ownership**: called by POST `/feedback` handler only (not by `deliverFeedback`)
3. Session IDs: MCP uses `{client-slug}-{generation}`, plugin uses OpenCode session IDs directly
4. `SessionEntry.close?()` callback: MCP passes `async () => transport.close()`, plugin can pass custom cleanup

## Build

- Root `tsconfig.json` with project references to all 3 packages
- `tsconfig.base.json`: shared compiler options (NodeNext, ES2022, strict, composite)
- `tsc -b` builds all packages. Each package has own `tsconfig.json` extending base.
- Plugin requires `"lib": ["ES2024"]` for `Promise.withResolvers`

## File Layout

```
packages/
  core/src/        → 9 files (session-manager, state-store, feedback-ui-server, logging, html)
  mcp/src/         → 2 files (index, stream-event-store)
  opencode-plugin/src/ → 2 files (index, daemon-prompt)
prompts/           → agent prompt markdown files
```
