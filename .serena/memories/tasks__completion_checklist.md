# Completion Checklist
- `npm run build` passes.
- Run `npm test` for behavior changes (especially `get_feedback`, path validation, roots handling).
- If transport/session logic changed, smoke-test startup and `/health` endpoint.
- For feedback UI changes, verify `/sessions` and session route behavior manually.
- Update README/docs when flags/endpoints/tool behavior changes.
- Confirm `/health` reports `transport: streamable-http` and `persistence: none`.
