Updated 2026-04-02.

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
- Remote mode: Telegram notifications with inline keyboard quick-replies
- "Show assistant messages" panel in UI (opt-in, displays agent's last message)
- Session alias display in Telegram messages

## File Structure
- `index.ts` — Main server (~1200 lines): MCP transport, UI server, REST API
- `session-manager.ts` — Session lifecycle, feedback state, aliases, auto-prune (~700 lines)
- `session-state-store.ts` — File-backed persistence
- `feedback-html.ts` + supporting scripts — Embedded web UI
- `channels.ts` — Remote notification channels (ChannelManager, TelegramChannel, repairHtml, markdown→HTML)
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
TypeScript, Node.js, Express, `@modelcontextprotocol/sdk`, grammY v1.41.1, `@grammyjs/runner` v2.0.3, Jest/ts-jest

## File Structure
All source under `src/`:
- `src/index.ts` — Main server (~1160 lines): MCP transport, UI server, REST API
- `src/session-manager.ts` — Session lifecycle, feedback state, aliases, auto-prune
- `src/session-state-store.ts` — File-backed persistence (`.tasksync/session-state.json`)
- `src/channels.ts` — Remote notification channels (ChannelManager, TelegramChannel)
- `src/stream-event-store.ts` — MCP-specific transient SSE replay
- `src/logging.ts` — Logging infrastructure + debug HTTP middleware
- `src/utils.ts` — Pure helpers (alias normalization, slug, response formatting)
- `src/ui/feedback-html.ts` — Main feedback UI HTML template
- `src/ui/styles.ts` — Enhanced CSS styles
- `src/ui/scripts.ts` — UI JavaScript (composer, history, sessions)
- `src/ui/markdown.ts` — Client-side markdown renderer
- `src/feedback-server.ts` — Standalone feedback web UI (alternative entry)

## Versions
- Server: `tasksync-mcp-http` — latest v1.3.0 (npm)
- Plugin: `opencode-tasksync` — latest v1.2.0 (npm)
- GitHub: `vikrant82/tasksync-mcp`

## Branches
- `main` — all work merged (PR #7 session alias + agent context + auto-prune, PR #8 restructuring)
