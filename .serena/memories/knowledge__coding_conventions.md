# Coding Conventions
- TypeScript strict mode (`strict: true`), ES2022 target, NodeNext modules.
- ESM imports with explicit `.js` suffix for local modules.
- Prefer explicit schemas for tool arguments via Zod + `zodToJsonSchema`.
- Keep cross-platform behavior explicit (darwin/windows/linux branching for browser open command).
- Error handling style: return MCP tool errors as `{ isError: true, content: [{type:'text', text: ...}] }`.
- Logging style: operational events go to `console.error` (server-side diagnostics).
- Tests use Jest with focused unit tests under `__tests__/`.
- Avoid unsafe path access; always go through allowed directory validation helpers.
