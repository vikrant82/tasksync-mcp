# Project Overview
- Name: `tasksync-mcp`
- Purpose: MCP server to collect iterative human feedback for coding agents (`get_feedback`).
- Primary use: keep agent in a feedback loop instead of speculative autonomous completion.
- Current transport mode in codebase: `Streamable HTTP` MCP with session support.
- Runtime behavior: feedback UI is embedded (unless `--no-ui`) and routes feedback to in-memory per-session queues.
- Language/stack: TypeScript (NodeNext, ES2022), Node.js, Express, MCP TypeScript SDK, Zod JSON schema generation.
- License: MIT.
