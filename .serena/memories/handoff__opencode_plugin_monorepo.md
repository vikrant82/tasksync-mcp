# Handoff: OpenCode Plugin + Monorepo Refactor

**Date:** 2026-03-27

## Session Summary

Converted TaskSync from a single-package MCP server into a monorepo with three packages:
1. `@tasksync/core` — shared core (SessionManager, SessionStateStore, FeedbackUIServer, logging)
2. `tasksync-mcp` — MCP server entry point (existing functionality, refactored to use core)
3. `opencode-tasksync` — OpenCode plugin entry point (NEW)

### Research Phase
Studied OpenCode plugin system (docs, SDK, MCP server docs), analyzed reference plugins (opencode-pty, octto), identified octto as closest analog (promise-based waiters = our get_feedback pattern).

### Implementation Phase
1. Created workspace structure: root package.json with workspaces, shared tsconfig.base.json, per-package tsconfigs with project references
2. Extracted shared core from original index.ts:
   - `SessionManager` made transport-agnostic (renamed StreamableSessionEntry → SessionEntry, removed MCP imports, `close?()` callback pattern)
   - `FeedbackUIServer` class extracted from `startFeedbackUI()` — standalone Express server with SSE, all UI routes
   - `createLogger()` factory with Logger interface
   - Barrel exports in `packages/core/src/index.ts`
3. Refactored MCP server (`packages/mcp/src/index.ts`, ~1034 lines): imports core, keeps MCP-specific code (transport, debug logging, alias inference, keepalive)
4. Built OpenCode plugin (`packages/opencode-plugin/src/index.ts`, ~145 lines):
   - Plugin tool `get_feedback` using `tool()` from `@opencode-ai/plugin` with `Promise.withResolvers`
   - Event hook for `session.deleted` cleanup
   - Config hook injecting `daemon` agent with full daemon loop prompt
   - `daemon-prompt.ts` adapted from `task-sync-agent-opencode.md`

### Build Status
All 3 packages build clean (`tsc -b` exits 0). Dist files verified.

## Immediate Goal

User is about to test both:
1. Plugin in OpenCode (config: `"plugin": ["./packages/opencode-plugin"]` in opencode.json)
2. MCP server locally (`node packages/mcp/dist/index.js`)

## Completed

- ✅ Research: OpenCode plugin system, SDK, reference plugins
- ✅ Monorepo workspace structure (root + 3 packages)
- ✅ Core package extraction (SessionManager, SessionStateStore, FeedbackUIServer, logging)
- ✅ MCP server refactored to use core
- ✅ OpenCode plugin built (get_feedback tool, event hook, config hook with daemon agent)
- ✅ All packages build clean
- ✅ Zod updated to v4 in plugin (matches @opencode-ai/plugin)

## Open Loops

- Runtime testing of MCP server from new location
- Plugin testing in OpenCode
- Image support limitation: plugin tool returns string only (no ImageContent blocks)
- Legacy files still in root (original index.ts, etc.) — need cleanup after testing
- Previous `simple-prune` branch work (SessionManager bug fixes) needs to be reconciled with monorepo changes
- Stale logs__ memories cleaned up (6 deleted), old simple-prune handoff deleted

## Key Decisions

1. Monorepo with shared core: `@tasksync/core` is the shared foundation
2. SessionEntry is transport-agnostic with optional `close?()` callback
3. Plugin auto-starts web UI on port 4596 (env: TASKSYNC_UI_PORT)
4. Plugin injects `daemon` agent via config hook
5. Plugin uses `Promise.withResolvers` for blocking get_feedback
6. Plugin doesn't support image return (OpenCode tool API returns string only)

## Files Modified/Created

### New directories
- `packages/core/src/` — 9 source files
- `packages/mcp/src/` — 2 source files
- `packages/opencode-plugin/src/` — 2 source files
- `prompts/` — moved agent prompt files

### Key new files
- `packages/core/src/feedback-ui-server.ts` — FeedbackUIServer class
- `packages/core/src/logging.ts` — Logger interface + createLogger
- `packages/core/src/index.ts` — barrel exports
- `packages/mcp/src/index.ts` — refactored MCP server
- `packages/opencode-plugin/src/index.ts` — plugin entry
- `packages/opencode-plugin/src/daemon-prompt.ts` — daemon agent prompt
- `tsconfig.base.json` — shared compiler options
- Per-package `package.json` and `tsconfig.json`

## Next Memories to Load

- `knowledge__architecture` — Core architecture details
- `tasks__refactoring_backlog` — Future refactoring plans
- `knowledge__project_overview` — Project context

## Resumption Prompt

The monorepo refactor is complete and builds clean. Three packages: `@tasksync/core` (shared), `tasksync-mcp` (MCP server), `opencode-tasksync` (plugin). User was about to test both the plugin (via `"plugin": ["./packages/opencode-plugin"]` in opencode.json) and the MCP server (via `node packages/mcp/dist/index.js`). Plugin auto-starts web UI on port 4596, injects `daemon` agent via config hook. MCP server uses ports 3011 (MCP) and 3456 (UI). Key limitation: plugin `get_feedback` returns string only (no image content blocks). Legacy root files still exist and need cleanup after testing confirms everything works.
