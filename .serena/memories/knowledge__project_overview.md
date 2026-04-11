Updated 2026-04-11.

`tasksync-mcp` provides iterative human feedback loops for coding agents through the `get_feedback` tool.

## Two Integration Paths

| Path | Best for | Setup |
|------|----------|-------|
| **OpenCode Plugin** | OpenCode users | Add to plugin array, zero config |
| **MCP Server** | VS Code Copilot, Claude Desktop, any MCP client | Start server, configure MCP endpoint |

## Key Features
- `get_feedback` blocks until feedback arrives (MCP uses streamable HTTP keepalive; plugin uses SSE with reconnect)
- Web-based feedback UI with multi-session support, image attachments, markdown toolbar, and assistant-message panel
- Desktop/sound notifications when agent is waiting
- Session persistence across server restarts
- Auto-prune of stale sessions with `Never` as the true persisted default
- Agent prompt injection (OpenCode plugin auto-injects daemon agent + optional augmentation)
- Remote mode: Telegram notifications with inline keyboard quick-replies
- Session alias display in Telegram messages and inferred session naming from OpenCode titles

## File Structure
All source under `src/`:
- `src/index.ts` — Main server: MCP transport, UI server, REST API
- `src/session-manager.ts` — Session lifecycle, feedback state, aliases, auto-prune
- `src/session-state-store.ts` — File-backed persistence (`.tasksync/session-state.json`)
- `src/channels.ts` — Remote notification channels (ChannelManager, TelegramChannel)
- `src/stream-event-store.ts` — MCP-specific transient SSE replay
- `src/logging.ts` — Logging infrastructure + debug HTTP middleware
- `src/utils.ts` — Pure helpers (alias normalization, slug, response formatting, version constants)
- `src/ui/feedback-html.ts` — Main feedback UI HTML template
- `src/ui/styles.ts` — Enhanced CSS styles
- `src/ui/scripts.ts` — UI JavaScript (composer, history, sessions)
- `src/ui/markdown.ts` — Client-side markdown renderer
- `src/feedback-server.ts` — Standalone feedback web UI (alternative entry)
- `opencode-plugin/` — Standalone OpenCode plugin package (thin HTTP client)

## Agent Prompt Files
- `task-sync-agent-opencode.md` — OpenCode daemon prompt (MCP mode, uses `tasksync_get_feedback`)
- `task-sync-agent-copilot.md` — VS Code Copilot daemon prompt

## Stack
TypeScript, Node.js, Express, `@modelcontextprotocol/sdk`, grammY v1.41.1, `@grammyjs/runner` v2.0.3

## Versions
- Server: `tasksync-mcp-http` — latest v1.4.1
- Plugin: `opencode-tasksync` — latest v1.3.1
- GitHub: `vikrant82/tasksync-mcp`

## External Reference Directories (NOT part of this repo)
- `opencode/` — OpenCode source checkout, for reference only. Do not modify unless asked.
- `opencode-dynamic-context-pruning/` — Separate project checkout, for reference only. Do not modify unless asked.

## Branches
- `main` — includes PR #12 plus release bump commit `1136857` for v1.4.1 / plugin v1.3.1
