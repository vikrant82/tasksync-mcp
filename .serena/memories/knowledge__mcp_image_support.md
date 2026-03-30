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

### OpenCode Plugin Image Support (COMPLETED — March 2026)

**Native injection via `tool.execute.after` hook:**
- Images received via SSE feedback event, cached in module-level `pendingImages` Map keyed by OpenCode `sessionID`
- `tool.execute.after` hook fires after `execute()` returns but before result is persisted
- Hook injects images as `FilePart` attachments with proper PartBase fields:
  - `id`: `prt_` + timestamp-based ID
  - `sessionID`: from hook `input.sessionID` (real OpenCode session ID)
  - `messageID`: `msg_` + timestamp-based ID
  - Plus `type: "file"`, `mime`, `filename`, `url` (data URI with base64)
- OpenCode validates against zod schema: id starts with "prt", sessionID with "ses", messageID with "msg"
- LLM sees images natively — no file-reading tools needed

**Root cause of earlier Layer 2 failures:**
1. `experimental.chat.messages.transform` hook: `context.metadata({ imageRef })` was called during execute, but OpenCode's `fromPlugin()` wrapper discards callback metadata. Only `{ truncated }` was persisted. Transform hook never saw imageRef.
2. First `tool.execute.after` attempt: attachments lacked PartBase fields (id/sessionID/messageID). OpenCode threw zod validation errors.

**Layer 1 (temp files) — REMOVED:**
- Previously saved images to `$TMPDIR/tasksync-images/<sessionId>/image-N.<ext>` and appended paths to text response
- Removed after Layer 2 proved reliable — text paths were redundant noise
- Code preserved in `ref/layer1-temp-files` branch, documented in `knowledge__layer1_temp_files` memory

### Design Decision
Implemented MCP-spec-correct `ImageContent` blocks despite opencode's current limitation because:
1. Correct protocol behavior per MCP specification
2. Other clients may handle images properly
3. opencode will likely add support (they already have the internal types)
4. Potential to contribute a PR to opencode to fix their `runTool()` handler