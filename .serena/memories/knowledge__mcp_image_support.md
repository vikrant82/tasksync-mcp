Date: 2026-03-11

MCP image support research summary:
- MCP already supports returning images from tools via `CallToolResult.content`.
- Canonical image block shape is `ImageContent` with fields:
  - `type: 'image'`
  - `data: string` (base64-encoded image bytes)
  - `mimeType: string`
  - optional `annotations`
  - optional `_meta`
- `CallToolResult` includes:
  - required `content: ContentBlock[]`
  - optional `structuredContent`
  - optional `isError`
- This means a tool can return mixed content like:
  - text explanation block(s)
  - image block(s)
  - optional structured metadata
- TypeScript SDK already models and validates this shape (`packages/core/src/types/spec.types.ts`, `packages/core/src/types/types.ts`).
- Upstream conformance example returns image content from a tool using:
  - `{ content: [{ type: 'image', data: TEST_IMAGE_BASE64, mimeType: 'image/png' }] }`
- Planning guidance for this repo:
  - prefer returning a text block plus image block together for better client usability
  - use `structuredContent` for machine-readable metadata like dimensions/source if needed
  - next session should first identify the concrete tool or workflow that should emit images (feedback UI screenshots, generated diagrams, uploaded images, etc.) before implementation.
