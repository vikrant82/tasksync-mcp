# Handoff: Plugin Image Support

## Date
2026-03-28

## Session Summary
Completed the implementation of image support for the OpenCode plugin's `get_feedback` tool. Extensive research into OpenCode SDK types, Go backend architecture, and community plugin patterns. Implemented a two-layer approach since plugin `tool.execute()` can only return `Promise<string>`.

## Immediate Goal
Test the implementation in a real OpenCode session to verify both layers work.

## Completed
- Deep research of OpenCode SDK types (`@opencode-ai/plugin@1.3.3`, `@opencode-ai/sdk@1.3.3`)
- Confirmed hard constraint: `tool.execute()` → `Promise<string>` only, Go `ToolResult.Content` is string-only
- Studied community plugins (`opencode-vibeguard`, `opencode-dynamic-context-pruning`) for `experimental.chat.messages.transform` patterns
- Implemented Layer 1 (temp files): saves images to `$TMPDIR/tasksync-images/<sessionId>/image-N.<ext>`, returns text with file paths
- Implemented Layer 2 (experimental transform hook): caches images in `pendingImages` Map, links via UUID `imageRef` in tool metadata, transform hook injects `FilePart` entries with `data:` URIs into `ToolStateCompleted.attachments`
- Fixed memory leak: transform hook now deletes processed refs from `pendingImages`
- Build: clean (tsc), tests: 82/83 pass (1 pre-existing failure)
- Updated `knowledge__mcp_image_support` memory with plugin architecture details

## Open Loops
- **Layer 2 is untested**: Whether Go backend maps `FilePart` entries (from transform hook) to native LLM image content is unknown — Go plugin code is not public
- Layer 1 is reliable fallback — agents can use file-reading tools to view saved images
- Session cleanup in `event` handler deletes ALL `pendingImages` entries (fine for single-session, but could be improved for multi-session)

## Key Decisions
- Two-layer approach: robust fallback (temp files) + experimental best-effort (transform hook)
- Used `context.metadata()` to link images to tool state via UUID ref
- `data:` URI format in `FilePart.url` for inline image data
- Transform hook processes images on every LLM call (idempotent — deletes ref after first injection)

## Files Modified
- `opencode-plugin/src/index.ts` — added image handling (Layer 1 + Layer 2), transform hook, imports for fs/os/path
- `opencode-plugin/dist/index.js` — rebuilt from TypeScript

## Next Memories to Load
- `knowledge__architecture`
- `knowledge__project_overview`
- `knowledge__mcp_image_support`

## Resumption Prompt
Plugin image support is implemented but Layer 2 (experimental.chat.messages.transform) is untested. The implementation saves images to temp files (Layer 1, always works) and also injects them as FilePart entries via the transform hook (Layer 2, experimental). To test: start TaskSync server + OpenCode with the plugin, submit feedback with images via web UI, observe if the LLM can "see" the images. If Layer 2 doesn't work, Layer 1 still provides the images via file paths in the text response. Key file: `opencode-plugin/src/index.ts`.
