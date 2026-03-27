# TaskSync Project Overview

Updated 2026-03-27.

**TaskSync** enables iterative human feedback loops for coding agents via a blocking `get_feedback` tool and a web-based feedback UI.

## Two Distribution Modes

### 1. MCP Server (`tasksync-mcp` package)
- Streamable HTTP MCP server with `get_feedback` tool
- Works with any MCP client (OpenCode, Claude Desktop, Cursor, etc.)
- SSE keepalive (`: keepalive\n\n` every 30s) keeps connection alive during blocking waits
- Default: no timeout, waits indefinitely. Legacy heartbeat mode available (`--heartbeat`)
- CLI: `node packages/mcp/dist/index.js --port=3011 --ui-port=3456`

### 2. OpenCode Plugin (`opencode-tasksync` package)
- Native OpenCode plugin with `get_feedback` as a plugin tool (no MCP prefix)
- Injects `daemon` agent via config hook with full daemon loop prompt
- Event-driven cleanup on `session.deleted`
- Config: `"plugin": ["opencode-tasksync"]` in opencode.json
- Env vars: `TASKSYNC_UI_PORT` (default 4596), `TASKSYNC_NO_BROWSER`

### Shared Core (`@tasksync/core` package)
Both modes share the same feedback engine, session management, UI server, and web frontend.

## Key Features
- **Feedback UI**: Two-column layout — composer/history (left), sessions/settings (right). SSE-powered live updates.
- **Image support**: paste, drag-drop, or attach images. Sent as base64. MCP returns `ImageContent` blocks, plugin returns text description.
- **Markdown toolbar**: formatting buttons, keyboard shortcuts, Tab indent, auto-continue lists.
- **Session management**: Per-session feedback history, session aliases, auto-prune of stale sessions.
- **Persistence**: `.tasksync/session-state.json` for metadata/history. Replay is transient/in-memory.
- **Logging**: Optional file logging (`TASKSYNC_LOG_FILE`), configurable log levels.

## Agent Prompts
Located in `prompts/`:
- `task-sync-agent-opencode.md` / `task-sync-agent-copilot.md` — default keepalive mode
- Heartbeat variants available for legacy [WAITING] mode

## Stack
TypeScript, Node.js, Express, npm workspaces monorepo. Build: `tsc -b` with project references.

## Repository Structure
```
packages/
  core/          → @tasksync/core (shared foundation)
  mcp/           → tasksync-mcp (MCP server)
  opencode-plugin/ → opencode-tasksync (OpenCode plugin)
prompts/         → Agent prompt markdown files
```
