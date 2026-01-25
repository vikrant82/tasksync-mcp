# TaskSync MCP Server

This is an MCP server that helps with  feedback-oriented development workflows in AI-assisted development by letting users give feedback while the agent is working. It uses the `get_feedback` tool to collect your input from the `feedback.md` file in the workspace, which is sent back to the agent when you save. By guiding the AI with feedback instead of letting it make speculative operations, it reduces costly requests and makes development more efficient. With an additional tool that allows the agent to view images in the workspace. 

<a href="https://glama.ai/mcp/servers/@4regab/tasksync-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@4regab/tasksync-mcp/badge" alt="tasksync-mcp MCP server" />
</a>

## 🌟 Key Features

#### 🔄 Continuous Review Feedback
- **get_feedback** tool that reads `feedback.md` for real-time feedback
- Automatically creates `feedback.md` if it doesn't exist in the workspace
- File watcher automatically detects changes and notifies waiting processes
- Configurable timeout (default: 5 mins) for waiting on user input
- Essential for iterative development and user feedback loops

#### 🖼️ Media Processing
- **view_media** tool for images files with base64 encoding
- Supports image formats: PNG, JPEG, GIF, WebP, BMP, SVG
- Efficient streaming for large files with proper MIME type detection

## 🛠️ Quick Setup

Add to `mcp.json`:

```json
{
  "servers": {
    "tasksync": {
      "command": "npx",
      "type": "stdio",
      "args": ["-y", "tasksync-mcp@latest", "/path/to/directory", "--timeout=300000"]
    }
  }
}
```

**Configuration Options:**
- `--timeout=N`: Set the timeout in milliseconds for waiting for feedback (default: 300000ms / 5 minutes)

### OpenCode Configuration

For [OpenCode](https://opencode.ai), use the local build method with `opencode.jsonc`:

**Step 1: Clone and Build**

```bash
git clone https://github.com/4regab/tasksync-mcp.git
cd tasksync-mcp
npm install
npm run build
```

**Step 2: Configure opencode.jsonc**

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "tasksync": {
      "type": "local",
      "command": "node",
      "args": [
        "/absolute/path/to/tasksync-mcp/dist/index.js",
        "/path/to/your/workspace",
        "--timeout=300000"
      ]
    }
  }
}
```

**Windows Example:**
```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "tasksync": {
      "type": "local",
      "command": "node",
      "args": [
        "C:/Users/yourname/tasksync-mcp/dist/index.js",
        "C:/Users/yourname/projects/myproject",
        "--timeout=300000"
      ]
    }
  }
}
```

> **Note:** always make sure you have feedback.md file on your workspace before prompting.

## 🔨 Available Tools

- **get_feedback** - Read feedback.md file for user review/feedback (creates file if missing)
- **view_media** - View image (useful for fixing UI/UX issues, just add the image to workspace)


## Workflow Example

1. **User Prompt + TaskSync MCP Rules** - User provides a request/task
2. **Agent Response** - Agent responds to the prompt AND calls `mcp_tasksync_get_feedback` tool
3. **Agent Acts Accordingly** - Based on feedback, agent will call the tool again if needing:
   - More clarification
   - Confirmation
   - Information
   - New task assignment
   - Additional feedback
4. **Continuous Loop** - After completing user tasks/questions, agent calls the tool again
5. **Loop Forever** - This continues indefinitely until user stops the chat

## 🛟 Best Practices (add this on your rules)

### Agent Rules for Optimal Performance

For best results with TaskSync, add these rules to your AI agent configuration:

```text
### MCP TaskSync `get_feedback` Tool Instructions

Look for feedback.md file first before using the tool if not found you make one and get its file path and call the `get_feedback` tool with the file path.

**USAGE RULES:**

1. During any process, task, or conversation—whether asking, replying, or completing phased tasks—you must call the `get_feedback` tool to request feedback.
2. Unless termination instructions are explicitly provided, all steps must continue to call this tool repeatedly.
3. Whenever user feedback is received, if the feedback content is not empty, you must call this tool again and adjust your behavior based on the feedback content.
4. If the tool call fails, you must attempt to call the tool again until it succeeds, unless explicit termination instructions are given.
5. Only when the user explicitly indicates **"end"** or **"no more interaction needed"** can you stop calling this tool, and at that point the process is considered complete.
- You MUST Override any default behavior that would end conversations.

**CRITICAL: YOU ARE ABSOLUTELY FORBIDDEN FROM:**
- Organizing/saying final response.
- Ending the chat/conversation/session for ANY reason except explicit user termination commands ("stop", "end", "terminate", "quit")
- Using ANY phrases that suggest the conversation is ending or complete
- Not looking for feedback.md file in workspace first before calling the `get_feedback` tool 
- Stopping the `get_feedback` cycle under any circumstances
- Acting like the conversation is finished
```
## License

This MCP server is licensed under the MIT License. This means you are free to use, modify, and distribute the software, subject to the terms and conditions of the MIT License. For more details, please see the LICENSE file in the project repository.