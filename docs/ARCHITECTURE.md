# Architecture

Current architecture diagram:

- Excalidraw: https://excalidraw.com/#json=zq9tVQQAGw9e1IJ9R1VpF,fTW-cPTG33xhdpKG6ij-lg

This diagram reflects the current structure after extracting the integrated web UI and feedback server into `src/ui-server.ts`.

## High-Level Boundaries

- `src/index.ts` — MCP server, session bootstrap, Streamable HTTP transport wiring
- `src/ui-server.ts` — feedback web UI, REST endpoints, interrupt endpoint, plugin SSE wait stream
- `src/session-manager.ts` — sessions, waiters, queued feedback, urgent feedback, aliases, auto-prune
- `src/session-state-store.ts` — persisted session state in `.tasksync/session-state.json`
- `src/channels.ts` — notification channels and Telegram reply routing
- `opencode-plugin/src/index.ts` — OpenCode plugin integration, session registration, SSE wait, interrupt polling

## Notes

- The Excalidraw diagram is a shareable snapshot, not a generated artifact checked into the repo.
- Update this link if the major module boundaries change significantly.
