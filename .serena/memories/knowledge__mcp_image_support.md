Updated: 2026-03-18

## MCP ImageContent — Spec & Implementation Status

### MCP SDK Types
- `ImageContent`: `{ type: 'image'; data: string (base64); mimeType: string; annotations?: Annotations; _meta?: Record }`
- `CallToolResult.content` is `ContentBlock[]` = `TextContent | ImageContent | AudioContent | ResourceLink | EmbeddedResource`
- Mixed content blocks (text + image) are fully supported in `CallToolResult`

### tasksync-mcp Implementation (COMPLETED — branch `image_support`)
- `formatFeedbackResponse(content, images?)` returns mixed `TextContent + ImageContent` blocks when images are present
- `ImageAttachment` type: `{ data: string; mimeType: string }` defined in `session-state-store.ts`
- Full pipeline: paste/drop/attach → base64 → `POST /feedback` → backend propagation → MCP response with ImageContent blocks → SSE history with images
- Frontend limits: 10MB per image, max 10 images, validated MIME types (image/png, image/jpeg, image/gif, image/webp, image/svg+xml)
- Express JSON body limit increased to 50mb for base64 payloads

### Client Compatibility
- **opencode** (as of 2025-09-18 `main`): Does NOT handle `ImageContent` from MCP tool results. Only `TextContent` is extracted in `runTool()` (`internal/llm/agent/mcp-tools.go`). Image data gets `fmt.Sprintf`'d into useless Go struct text. They have `BinaryContent` and `ImageURLContent` types in their message system but haven't wired MCP images through.
- **Claude Desktop**: Expected to handle `ImageContent` properly (native MCP support)
- **VS Code Copilot**: Unknown — needs testing
- **Cursor**: Unknown — needs testing

### OpenCode Plugin Image Support (IMPLEMENTED — March 2026)

Two-layer approach since plugin `tool.execute()` returns `Promise<string>` only:

**Layer 1 — Temp Files (Reliable Fallback)**
- Images saved to `$TMPDIR/tasksync-images/<sessionId>/image-N.<ext>`
- Tool returns: `"<feedback text>\n\n[User attached N image(s): <paths>]"`
- Agents can read images via file-reading tools (e.g., MCP `Read` tool supports images)

**Layer 2 — experimental.chat.messages.transform Hook (Best-Effort)**
- Images cached in module-level `pendingImages` Map keyed by UUID ref
- Ref stored in tool state via `context.metadata({ metadata: { imageRef } })`
- Transform hook scans message history for `get_feedback` ToolParts with matching `imageRef`
- Injects `FilePart` entries with `data:` URIs into `ToolStateCompleted.attachments`
- Community-plugin pattern was valid, and a real TaskSync/OpenCode test on 2026-03-29 showed the model could directly inspect an attached screenshot delivered from a `get_feedback` tool result
- This is strong evidence the OpenCode path can surface tool-result image attachments to the model in practice

**Key Constraints Discovered:**
- Plugin `tool.execute()` → `Promise<string>` only (no structured content)
- Go `ToolResult.Content` is string-only; providers send string to LLM APIs
- `ToolStateCompleted.attachments` exists in TypeScript types but Go-side handling is opaque
- Go public repo (github.com/opencode-ai/opencode) predates plugin system; plugin IPC is not visible
- `@opencode-ai/plugin@1.3.3`, `@opencode-ai/sdk@1.3.3` are latest versions

### Design Decision
Implemented MCP-spec-correct `ImageContent` blocks despite opencode's current limitation because:
1. Correct protocol behavior per MCP specification
2. Other clients may handle images properly
3. opencode will likely add support (they already have the internal types)
4. Potential to contribute a PR to opencode to fix their `runTool()` handler