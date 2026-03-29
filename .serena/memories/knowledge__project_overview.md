Updated 2026-03-27.

`tasksync-mcp` provides iterative human feedback loops for coding agents through the `get_feedback` tool.

## Two Integration Paths

| Path | Best for | Setup |
|------|----------|-------|
| **OpenCode Plugin** | OpenCode users | Add to plugin array, zero config |
| **MCP Server** | VS Code Copilot, Claude Desktop, any MCP client | Start server, configure MCP endpoint |

## Key Features
- `get_feedback` blocks until feedback arrives (SSE keepalive for MCP, long-poll for plugin)
- Web-based feedback UI with multi-session support, image attachments, markdown toolbar
- Desktop/sound notifications when agent is waiting
- Session persistence across server restarts
- Auto-prune of stale sessions
- Agent prompt injection (OpenCode plugin auto-injects daemon agent + optional augmentation)

## File Structure
- `index.ts` — Main server (~1200 lines): MCP transport, UI server, REST API
- `session-manager.ts` — Session lifecycle, feedback state, aliases, auto-prune (~700 lines)
- `session-state-store.ts` — File-backed persistence
- `feedback-html.ts` + supporting scripts — Embedded web UI
- `stream-event-store.ts` — MCP-specific transient SSE replay
- `opencode-plugin/` — Standalone OpenCode plugin package (thin HTTP client)
  - `src/index.ts` — Plugin entry (tools, config hook, event hook)
  - `src/config.ts` — Config loader (`.tasksync/config.json` global + project + env vars)
  - `src/daemon-prompt.ts` — Full standalone daemon agent prompt
  - `src/daemon-overlay.ts` — Full overlay for augmented agents
  - `src/daemon-overlay-compact.ts` — Compact overlay

## Agent Prompt Files
- `task-sync-agent-opencode.md` — OpenCode daemon prompt (MCP mode, uses `tasksync_get_feedback`)
- `task-sync-agent-copilot.md` — VS Code Copilot daemon prompt

## Stack
TypeScript, Node.js, Express, `@modelcontextprotocol/sdk`, Jest/ts-jest

## Branch: `main`
All work merged. Published: `tasksync-mcp-http@1.0.0` (server), `opencode-tasksync@1.0.0` (plugin).
Old branches: `simple-prune` (merged), `opencode-plugin` (parked monorepo approach).
