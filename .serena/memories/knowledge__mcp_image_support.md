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

### Design Decision
Implemented MCP-spec-correct `ImageContent` blocks despite opencode's current limitation because:
1. Correct protocol behavior per MCP specification
2. Other clients may handle images properly
3. opencode will likely add support (they already have the internal types)
4. Potential to contribute a PR to opencode to fix their `runTool()` handler
