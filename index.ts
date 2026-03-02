#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  RootsListChangedNotificationSchema,
  type Root,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import { createReadStream, watch, FSWatcher } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn, type ChildProcess } from "child_process";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import express from "express";
import { normalizePath, expandHome } from './path-utils.js';
import { getValidRootDirectories } from './roots-utils.js';
import {
  validatePath,
  readFileContent,
  tailFile,
  headFile,
  setAllowedDirectories,
} from './lib.js';

const DEFAULT_TIMEOUT = 30000; // 30 seconds — must be less than MCP client timeout
// Parse configuration from environment variables or command line

// Command line argument parsing with embedded mode support
const args = process.argv.slice(2);
const useSSE = args.includes('--sse');
const noUI = args.includes('--no-ui');
const ssePort = parseInt(args.find(arg => arg.startsWith('--port='))?.split('=')[1] || '3001');
const uiPortArg = args.find(arg => arg.startsWith('--ui-port='));
const uiPort = parseInt(uiPortArg?.split('=')[1] || process.env.FEEDBACK_PORT || '3456');
const directoryArgs = args.filter(arg =>
  !['--sse', '--embedded', '--stdio', '--no-ui'].some(flag => arg.startsWith(flag)) &&
  !arg.startsWith('--port=') &&
  !arg.startsWith('--ui-port=') &&
  !arg.startsWith('--timeout=')
);
const timeoutArg = args.find(arg => arg.startsWith('--timeout='));
const parsedTimeout = timeoutArg ? parseInt(timeoutArg.split('=')[1]) : NaN;
const feedbackTimeout = !isNaN(parsedTimeout) ? parsedTimeout : DEFAULT_TIMEOUT;

// Store allowed directories in normalized and resolved form
let allowedDirectories: string[] = [];

// Auto-detect current directory if no directories provided
allowedDirectories = directoryArgs.length === 0
  ? [normalizePath(process.cwd())]
  : await Promise.all(directoryArgs.map(async (dir) => {
    const absolute = path.resolve(expandHome(dir));
    try {
      return normalizePath(await fs.realpath(absolute));
    } catch {
      return normalizePath(absolute);
    }
  }));

directoryArgs.length === 0 && console.error(`Auto-detected allowed directory: ${allowedDirectories[0]}`);

// Validate that all directories exist and are accessible
await Promise.all(allowedDirectories.map(async (dir) => {
  try {
    const stats = await fs.stat(dir);
    if (!stats.isDirectory()) throw new Error(`${dir} is not a directory`);
  } catch (error) {
    console.error(`Error accessing directory ${dir}:`, error);
    process.exit(1);
  }
}));

// Initialize the global allowedDirectories in lib.ts
setAllowedDirectories(allowedDirectories);

// File watching state for check_review (support multiple files)
const lastFileModifiedByPath: Map<string, number> = new Map();
const fileWatchers: Map<string, FSWatcher> = new Map();
const connectedTransports: Set<SSEServerTransport> = new Set();

// Track last-returned content per path to detect actual content changes (not mtime-based)
const lastReturnedContent: Map<string, string> = new Map();

// Long-poll settings: block inside get_feedback to reduce context entries
const INTERNAL_POLL_MS = 3000;  // Check file every 3s inside the blocking call
const MAX_WAIT_MS = 60000;      // Block for up to 60s before returning [WAITING]

// Lazy initialization state
let isInitialized = false;

// Schema definitions

const AskReviewArgsSchema = z.object({
  path: z.string().optional().describe('Absolute or relative path to the feedback file within allowed directories. Defaults to feedback.md in the current working directory.'),
  tail: z.number().optional().describe('If provided, returns only the last N lines of the review file'),
  head: z.number().optional().describe('If provided, returns only the first N lines of the review file')
});

const ReadImageFileArgsSchema = z.object({
  path: z.string()
});

// Define ToolInput type for JSON Schema objects returned by zodToJsonSchema
type ToolInput = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};

function formatResponseWithHeadTail(content: string, head?: number, tail?: number): { content: { type: "text", text: string }[] } {
  if (head && tail) {
    throw new Error("Cannot specify both head and tail parameters simultaneously");
  }

  if (tail) {
    const lines = content.split('\n');
    const tailLines = lines.slice(-tail);
    return {
      content: [{ type: "text", text: tailLines.join('\n') }],
    };
  }

  if (head) {
    const lines = content.split('\n');
    const headLines = lines.slice(0, head);
    return {
      content: [{ type: "text", text: headLines.join('\n') }],
    };
  }

  return {
    content: [{ type: "text", text: content }],
  };
}

// Server setup

const server = new Server(
  {
    name: "tasksync-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      logging: {}, // Enable logging for notifications
    },
  },
);

// Lazy initialization for file watcher
async function ensureInitialized() {
  if (isInitialized) return;
  console.error("Initializing TaskSync server components...");
  const feedbackFile = path.join(process.cwd(), 'feedback.md');
  await setupFileWatcher(feedbackFile, true);
  // Seed lastReturnedContent with existing file content so stale content isn't treated as new
  try {
    const validFeedbackPath = await validatePath(feedbackFile);
    const existingContent = await readFileContent(validFeedbackPath);
    const trimmed = existingContent.trim();
    if (trimmed.length > 0) {
      lastReturnedContent.set(validFeedbackPath, trimmed);
      console.error(`Seeded lastReturnedContent for ${validFeedbackPath} (${trimmed.length} chars)`);
    }
  } catch { /* file might not exist yet, that's fine */ }
  isInitialized = true;
  console.error("TaskSync server initialized successfully");
}

// File watching functions
async function setupFileWatcher(filePath: string, createIfMissing: boolean = false) {
  try {
    // Check if file exists, create if it doesn't
    try {
      await fs.access(filePath);
      console.error(`File exists: ${filePath}`);
    } catch {
      if (!createIfMissing) {
        console.error(`File does not exist, skipping watcher: ${filePath}`);
        return;
      }
      console.error(`Creating file: ${filePath}`);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, 'No review content yet.');
    }

    // Get initial modification time and setup watcher
    const stats = await fs.stat(filePath);
    const mtime = stats.mtime.getTime();
    lastFileModifiedByPath.set(filePath, mtime);
    console.error(`Initial file modification time for ${filePath}: ${mtime}`);

    if (!fileWatchers.has(filePath)) {
      const watcher = watch(filePath, async (eventType) => {
        console.error(`File watcher event: ${eventType} for ${filePath}`);
        // Handle both 'change' and 'rename' events — macOS editors often emit 'rename' for atomic saves
        if (eventType === 'change' || eventType === 'rename') {
          await notifyClientsOfFileChange(filePath);
        }
      });
      fileWatchers.set(filePath, watcher);
      console.error(`File watcher setup successfully for: ${filePath}`);
    }
  } catch (error) {
    console.error(`Failed to setup file watcher: ${error}`);
    throw error;
  }
}

async function notifyClientsOfFileChange(filePath: string) {
  try {
    const stats = await fs.stat(filePath);
    const currentModified = stats.mtime.getTime();

    if (lastFileModifiedByPath.get(filePath) === currentModified) return;

    console.error(`File change detected for ${filePath}: ${lastFileModifiedByPath.get(filePath)} -> ${currentModified}`);
    lastFileModifiedByPath.set(filePath, currentModified);
    const content = await readFileContent(filePath);

    // Send notifications to all connected SSE clients
    const notifications = connectedTransports.size;
    await Promise.allSettled([...connectedTransports].map(transport =>
      transport.send({
        jsonrpc: "2.0",
        method: "notifications/message",
        params: {
          level: "info",
          logger: "tasksync-server",
          data: {
            type: "file_changed",
            path: path.relative(process.cwd(), filePath) || filePath,
            content,
            timestamp: new Date().toISOString()
          }
        }
      }).catch(error => console.error(`Failed to send notification to client: ${error}`))
    ));

    console.error(`File change notification sent to ${notifications} SSE clients for ${filePath}`);
  } catch (error) {
    console.error(`Error in notifyClientsOfFileChange: ${error}`);
  }
}

// Reads a file as a stream of buffers, concatenates them, and then encodes
// the result to a Base64 string. This is a memory-efficient way to handle
// binary data from a stream before the final encoding.
async function readFileAsBase64Stream(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => {
      chunks.push(chunk as Buffer);
    });
    stream.on('end', () => {
      const finalBuffer = Buffer.concat(chunks);
      resolve(finalBuffer.toString('base64'));
    });
    stream.on('error', (err) => reject(err));
  });
}

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_feedback",
        description:
          "Read the contents of a feedback.md file (defaults to ./feedback.md). Before calling this tool you must seearch for the feedback.md file." +
          "If the feedback file does not exist, you will automatically create an empty feedback.md file before attempting to use this tool. " +
          "During any process, task, or conversation, whether asking, replying, or completing phased tasks, you must call this tool to check for review. " +
          "Only when the user explicitly indicates <end or no more interaction needed> can you stop calling this tool, and the process is considered complete.\n\n" +
          "MANDATORY USAGE RULES -PRIMARY DIRECTIVE:\n" +
          "1. CONTINUOUS FEEDBACK LOOP: During any process, task, or conversation, whether asking, replying, or completing phased tasks, you MUST call this tool to check for feedback.\n" +
          "2. NO STOPPING WITHOUT PERMISSION: Unless receiving explicit termination instructions (\"end\", \"stop\", \"no more interaction needed\"), ALL steps must repeatedly call this tool.\n" +
          "3. RESPOND TO FEEDBACK: Whenever user feedback is received, if the feedback content is not empty, you MUST call this tool again and adjust behavior based on the feedback content.\n" +
          "4. TERMINATION CONDITIONS: Only when the user explicitly indicates \"end\", \"stop\", \"finished\", or \"no more interaction needed\" can you stop calling this tool.\n" +
          "5. PROVIDE CONTEXT: You should summarize what you have done and provide project context to help the user provide meaningful feedback for the next step.\n" +
          "6. KEEP ITERATING: If the user provides feedback, suggestions, or asks questions, continue the feedback loop by calling this tool again after addressing their input.\n" +
          "7. NEVER ASSUME COMPLETION: Do not assume a task is complete without explicit user confirmation through this feedback mechanism.\n\n",

        inputSchema: zodToJsonSchema(AskReviewArgsSchema, { target: "openApi3" }) as ToolInput,
      },
      {
        name: "view_media",
        description:
          "Read an image file. Returns the base64 encoded data and MIME type. " +
          "Only works within allowed directories.\n\n" +
          "SUPPORTED FORMATS:\n" +
          "Images: PNG, JPEG, GIF, WebP, BMP, SVG\n\n" +
          "USAGE:\n" +
          "Use this tool to read and encode image files for analysis, display, or processing. " +
          "The tool streams files efficiently and returns base64-encoded data with proper MIME type detection.\n\n" +
          "Args:\n" +
          "    path: Absolute or relative path to the image file within allowed directories",
        inputSchema: zodToJsonSchema(ReadImageFileArgsSchema, { target: "openApi3" }) as ToolInput,
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    // Ensure server is initialized on first tool call
    await ensureInitialized();

    const { name, arguments: args } = request.params;

    switch (name) {
      case "get_feedback": {
        const parsed = AskReviewArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for get_feedback: ${parsed.error}`);
        }
        // Determine path: use provided path if any, else default to ./feedback.md
        const targetPath = parsed.data.path || path.join(process.cwd(), 'feedback.md');

        // Create feedback.md file if it doesn't exist (only for default feedback.md, not custom paths)
        if (!parsed.data.path) {
          try {
            await fs.access(targetPath);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
              try {
                await fs.writeFile(targetPath, '', 'utf-8');
                console.error(`Created missing feedback file: ${targetPath}`);
              } catch (writeError) {
                console.error(`Failed to create feedback file: ${writeError}`);
                throw new Error(`Could not create feedback file: ${targetPath}`);
              }
            }
          }
        }

        const validPath = await validatePath(targetPath);

        if (parsed.data.head && parsed.data.tail) {
          throw new Error("Cannot specify both head and tail parameters simultaneously");
        }

        // Blocking long-poll: check file every INTERNAL_POLL_MS for up to MAX_WAIT_MS
        // This reduces context entries from ~6/min to ~1/min
        const pollStart = Date.now();
        while (true) {
          const content = parsed.data.tail ? await tailFile(validPath, parsed.data.tail)
            : parsed.data.head ? await headFile(validPath, parsed.data.head)
              : await readFileContent(validPath);

          const trimmed = content.trim();
          const lastContent = lastReturnedContent.get(validPath);

          // New content detected — return immediately
          if (trimmed.length > 0 && trimmed !== lastContent) {
            console.error(`get_feedback: New feedback detected (${trimmed.length} chars)`);
            lastReturnedContent.set(validPath, trimmed);
            return { content: [{ type: "text", text: content }] };
          }

          // Check if we've exceeded the max wait time
          if (Date.now() - pollStart >= MAX_WAIT_MS) {
            console.error(`get_feedback: No new feedback after ${MAX_WAIT_MS / 1000}s`);
            return { content: [{ type: "text", text: '[WAITING] No new feedback yet. Call get_feedback again to continue waiting.' }] };
          }

          // Wait before next internal poll
          await new Promise(resolve => setTimeout(resolve, INTERNAL_POLL_MS));
        }
      }

      case "view_media": {
        const parsed = ReadImageFileArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for view_media: ${parsed.error}`);
        }
        const validPath = await validatePath(parsed.data.path);
        const extension = path.extname(validPath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".gif": "image/gif",
          ".webp": "image/webp",
          ".bmp": "image/bmp",
          ".svg": "image/svg+xml",
        };
        const mimeType = mimeTypes[extension] || "application/octet-stream";
        const data = await readFileAsBase64Stream(validPath);
        const type = mimeType.startsWith("image/") ? "image" : "blob";
        return {
          content: [{ type, data, mimeType }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
});

// Updates allowed directories based on MCP client roots
async function updateAllowedDirectoriesFromRoots(requestedRoots: Root[]) {
  const validatedRootDirs = await getValidRootDirectories(requestedRoots);
  if (validatedRootDirs.length > 0) {
    allowedDirectories = [...validatedRootDirs];
    setAllowedDirectories(allowedDirectories); // Update the global state in lib.ts
    console.error(`Updated allowed directories from MCP roots: ${validatedRootDirs.length} valid directories`);
  } else {
    console.error("No valid root directories provided by client");
  }
}

// Handles dynamic roots updates during runtime, when client sends "roots/list_changed" notification, server fetches the updated roots and replaces all allowed directories with the new roots.
server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
  try {
    // Request the updated roots list from the client
    const response = await server.listRoots();
    if (response && 'roots' in response) {
      await updateAllowedDirectoriesFromRoots(response.roots);
    }
  } catch (error) {
    console.error("Failed to request roots from client:", error instanceof Error ? error.message : String(error));
  }
});

// Handles post-initialization setup, specifically checking for and fetching MCP roots.
server.oninitialized = async () => {
  const clientCapabilities = server.getClientCapabilities();

  if (clientCapabilities?.roots) {
    try {
      const response = await server.listRoots();
      if (response && 'roots' in response) {
        await updateAllowedDirectoriesFromRoots(response.roots);
      } else {
        console.error("Client returned no roots set, keeping current settings");
      }
    } catch (error) {
      console.error("Failed to request initial roots from client:", error instanceof Error ? error.message : String(error));
    }
  } else {
    if (allowedDirectories.length > 0) {
      console.error("Client does not support MCP Roots, using allowed directories set from server args:", allowedDirectories);
    } else {
      throw new Error(`Server cannot operate: No allowed directories available. Server was started without command-line directories and client either does not support MCP roots protocol or provided empty roots. Please either: 1) Start server with directory arguments, or 2) Use a client that supports MCP roots protocol and provides valid root directories.`);
    }
  }
};

// Start server
// Track spawned feedback UI process for cleanup
let feedbackUIProcess: ChildProcess | null = null;

function startFeedbackUI() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const serverScript = path.join(__dirname, 'feedback-server.js');
  const feedbackFile = path.join(process.cwd(), 'feedback.md');

  feedbackUIProcess = spawn('node', [serverScript, `--port=${uiPort}`, feedbackFile], {
    stdio: ['ignore', 'ignore', 'inherit'], // inherit stderr for logs, ignore stdin/stdout (MCP uses them)
    cwd: process.cwd(),
  });

  feedbackUIProcess.on('error', (err) => {
    console.error(`Feedback UI failed to start: ${err.message}`);
    feedbackUIProcess = null;
  });

  feedbackUIProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`Feedback UI exited with code ${code}`);
    }
    feedbackUIProcess = null;
  });

  console.error(`Feedback UI starting at http://localhost:${uiPort}`);

  // Auto-open the browser after a short delay to let the server start
  setTimeout(() => {
    const url = `http://localhost:${uiPort}`;
    spawn('open', [url], { stdio: 'ignore' });
  }, 1000);
}

async function runServer() {
  if (useSSE) {
    await runSSEServer();
  } else {
    await runStdioServer();
  }
}

async function runStdioServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("TaskSync MCP Server running on stdio");
  console.error(`Allowed directories: ${allowedDirectories.join(', ')}`);
  console.error("Server will initialize components when first tool is called");

  if (!noUI) {
    startFeedbackUI();
  }
}

async function runSSEServer() {
  const app = express();

  // Enable CORS for development
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
    } else {
      next();
    }
  });

  app.use(express.json());

  // SSE endpoint
  app.get("/sse", async (_, res) => {
    const transport = new SSEServerTransport('/messages', res);
    connectedTransports.add(transport);

    res.on("close", () => {
      connectedTransports.delete(transport);
      console.error(`Client disconnected. Active connections: ${connectedTransports.size}`);
    });

    console.error(`Client connected via SSE. Active connections: ${connectedTransports.size}`);
    await server.connect(transport);
  });

  // Messages endpoint for POST requests
  app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = Array.from(connectedTransports).find(t => t.sessionId === sessionId);

    if (transport) {
      await transport.handlePostMessage(req, res);
    } else {
      res.status(400).send("No transport found for sessionId");
    }
  });

  // Health check endpoint
  app.get("/health", (_, res) => {
    res.json({
      status: "ok",
      server: "tasksync-mcp",
      version: "1.0.0",
      connections: connectedTransports.size,
      allowedDirectories: allowedDirectories.length
    });
  });

  // Setup file watcher for default review file
  await setupFileWatcher(path.join(process.cwd(), 'feedback.md'), true);

  app.listen(ssePort, () => {
    console.error(`TaskSync MCP Server running on SSE at http://localhost:${ssePort}`);
    console.error(`SSE endpoint: http://localhost:${ssePort}/sse`);
    console.error(`Health check: http://localhost:${ssePort}/health`);
    console.error(`Allowed directories: ${allowedDirectories.join(', ')}`);
    console.error(`File watcher active for: feedback.md`);
  });
}

// Cleanup helper — safe to call multiple times
let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  console.error('\nShutting down server...');
  if (feedbackUIProcess) {
    feedbackUIProcess.kill();
    console.error('Stopped feedback UI');
  }
  for (const [watchedPath, watcher] of fileWatchers.entries()) {
    try {
      watcher.close();
      console.error(`Closed watcher for ${watchedPath}`);
    } catch { }
  }
}

// Handle all exit scenarios
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
process.on('exit', cleanup); // Final safety net (sync-only, but kill() is sync)

runServer().catch((error) => {
  console.error("Fatal error running TaskSync server:", error);
  process.exit(1);
});
