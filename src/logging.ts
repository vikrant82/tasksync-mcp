import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "crypto";
import express from "express";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// Module-level config — set once via configureLogging()
let configuredLogLevel: LogLevel = "info";
let configuredLogFilePath = "";
let configuredDebugBodyMaxChars = 2000;

export function configureLogging(opts: {
  logLevel?: string;
  logFilePath?: string;
  debugBodyMaxChars?: number;
}) {
  if (opts.logLevel) {
    configuredLogLevel = (opts.logLevel.toLowerCase() as LogLevel) || "info";
  }
  if (opts.logFilePath !== undefined) {
    configuredLogFilePath = opts.logFilePath;
  }
  if (opts.debugBodyMaxChars !== undefined) {
    configuredDebugBodyMaxChars = opts.debugBodyMaxChars;
  }
}

export function shouldLog(level: LogLevel): boolean {
  const configured = LOG_PRIORITY[configuredLogLevel] ?? LOG_PRIORITY.info;
  return LOG_PRIORITY[level] >= configured;
}

export function logEvent(level: LogLevel, event: string, details: Record<string, unknown> = {}) {
  if (!shouldLog(level)) return;
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...details,
  };
  const line = `[tasksync] ${JSON.stringify(payload)}`;
  console.error(line);
  if (configuredLogFilePath) {
    void appendLogLine(line);
  }
}

async function appendLogLine(line: string) {
  if (!configuredLogFilePath) return;
  await mkdir(path.dirname(configuredLogFilePath), { recursive: true });
  await appendFile(configuredLogFilePath, `${line}\n`, "utf8");
}

export function maybeParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

function parseSseDebugBody(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const blocks = trimmed.split(/\n\n+/);
  const events = blocks
    .map((block) => {
      const event: Record<string, unknown> = {};
      const dataLines: string[] = [];

      for (const rawLine of block.split("\n")) {
        const line = rawLine.replace(/\r$/, "");
        if (!line || line.startsWith(":")) continue;
        const separatorIndex = line.indexOf(":");
        const field = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line;
        let value = separatorIndex >= 0 ? line.slice(separatorIndex + 1) : "";
        if (value.startsWith(" ")) value = value.slice(1);

        if (field === "data") {
          dataLines.push(value);
          continue;
        }

        if (field === "retry") {
          const parsedRetry = Number(value);
          event.retry = Number.isFinite(parsedRetry) ? parsedRetry : value;
          continue;
        }

        event[field] = value;
      }

      if (dataLines.length > 0) {
        const dataText = dataLines.join("\n");
        event.data = maybeParseJson(dataText);
      }

      return Object.keys(event).length > 0 ? event : null;
    })
    .filter((event): event is Record<string, unknown> => event !== null);

  if (events.length === 0) {
    return text;
  }

  return {
    sseEvents: events,
  };
}

export function normalizeDebugBody(body: unknown, contentType?: string): unknown {
  if (Buffer.isBuffer(body)) {
    return normalizeDebugBody(body.toString("utf8"), contentType);
  }
  if (body instanceof Uint8Array) {
    return normalizeDebugBody(Buffer.from(body).toString("utf8"), contentType);
  }
  if (Array.isArray(body) && body.every((item) => typeof item === "number")) {
    return normalizeDebugBody(Buffer.from(body).toString("utf8"), contentType);
  }
  if (typeof body === "string") {
    if (contentType?.includes("text/html")) {
      return `[HTML content omitted, ${body.length} chars]`;
    }
    if (contentType?.includes("text/event-stream")) {
      return parseSseDebugBody(body);
    }
    if (body.length > configuredDebugBodyMaxChars) {
      return maybeParseJson(body.slice(0, configuredDebugBodyMaxChars) + `... [truncated, ${body.length} total chars]`);
    }
    return maybeParseJson(body);
  }
  if (body === undefined) {
    return null;
  }
  return body;
}

export function extractMcpDebugMeta(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {};
  }

  const record = body as Record<string, unknown>;
  const method = typeof record.method === "string" ? record.method : undefined;
  const id = typeof record.id === "string" || typeof record.id === "number" ? record.id : undefined;
  const params = record.params && typeof record.params === "object" && !Array.isArray(record.params)
    ? (record.params as Record<string, unknown>)
    : undefined;
  const result = record.result && typeof record.result === "object" && !Array.isArray(record.result)
    ? (record.result as Record<string, unknown>)
    : undefined;

  const meta: Record<string, unknown> = {};
  if (id !== undefined) meta.jsonRpcId = id;
  if (method) {
    meta.mcpMethod = method;
    if (method === "tools/call") {
      const toolName = typeof params?.name === "string" ? params.name : undefined;
      if (toolName) meta.mcpToolName = toolName;
    }
  }

  if (result) {
    if (Array.isArray(result.tools)) {
      meta.mcpResponseKind = "tools/list";
      meta.mcpToolCount = result.tools.length;
    } else if (Array.isArray(result.content)) {
      meta.mcpResponseKind = "tools/call";
      meta.mcpContentCount = result.content.length;
    }
  }

  return meta;
}

export function logDebugPretty(label: string, payload: unknown) {
  if (!shouldLog("debug")) return;
  const formatted = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  const line = `[tasksync][debug] ${label}\n${formatted}`;
  console.error(line);
  if (configuredLogFilePath) {
    void appendLogLine(line);
  }
}

export function installDebugHttpLogging(app: express.Express, scope: string) {
  app.use((req, res, next) => {
    if (!shouldLog("debug")) {
      next();
      return;
    }

    const startedAt = Date.now();
    const requestId = randomUUID();
    const responseChunks: Buffer[] = [];
    let totalResponseBytes = 0;
    const MAX_RESPONSE_LOG_BYTES = 50_000;
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);

    function toLoggedBuffer(chunk: unknown): Buffer | null {
      if (chunk === undefined || chunk === null) return null;
      if (Buffer.isBuffer(chunk)) return chunk;
      if (chunk instanceof Uint8Array) return Buffer.from(chunk);
      if (Array.isArray(chunk) && chunk.every((item) => typeof item === "number")) {
        return Buffer.from(chunk);
      }
      return Buffer.from(String(chunk), "utf8");
    }

    function shouldCapture(chunk: Buffer): boolean {
      const text = chunk.toString("utf8");
      if (text === ": keepalive\n\n") return false;
      if (totalResponseBytes >= MAX_RESPONSE_LOG_BYTES) return false;
      return true;
    }

    res.write = ((chunk: unknown, ...args: unknown[]) => {
      const loggedChunk = toLoggedBuffer(chunk);
      if (loggedChunk && shouldCapture(loggedChunk)) {
        responseChunks.push(loggedChunk);
        totalResponseBytes += loggedChunk.length;
      }
      return originalWrite(chunk as never, ...(args as Parameters<typeof originalWrite> extends [unknown, ...infer Rest] ? Rest : never));
    }) as typeof res.write;

    res.end = ((chunk?: unknown, ...args: unknown[]) => {
      const loggedChunk = toLoggedBuffer(chunk);
      if (loggedChunk) {
        responseChunks.push(loggedChunk);
      }
      return originalEnd(chunk as never, ...(args as Parameters<typeof originalEnd> extends [unknown?, ...infer Rest] ? Rest : never));
    }) as typeof res.end;

    logDebugPretty(`${scope}.request`, {
      requestId,
      method: req.method,
      path: req.path,
      query: req.query,
      headers: req.headers,
      ...extractMcpDebugMeta(normalizeDebugBody(req.body, String(req.headers["content-type"] || ""))),
      body: normalizeDebugBody(req.body, String(req.headers["content-type"] || "")),
    });

    res.on("finish", () => {
      const rawBody = Buffer.concat(responseChunks).toString("utf8");
      const responseContentType = String(res.getHeader("content-type") || "");
      const normalizedResponseBody = normalizeDebugBody(rawBody, responseContentType);
      logDebugPretty(`${scope}.response`, {
        requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        headers: res.getHeaders(),
        ...extractMcpDebugMeta(normalizedResponseBody),
        body: normalizedResponseBody,
      });
    });

    next();
  });
}
