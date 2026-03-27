import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  log(level: LogLevel, event: string, details?: Record<string, unknown>): void;
}

const LOG_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LoggerOptions {
  level?: LogLevel;
  filePath?: string;
  prefix?: string;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const configuredLevel = options.level ?? "info";
  const filePath = options.filePath?.trim() || "";
  const prefix = options.prefix ?? "tasksync";

  function shouldLog(level: LogLevel): boolean {
    const configured = LOG_PRIORITY[configuredLevel] ?? LOG_PRIORITY.info;
    return LOG_PRIORITY[level] >= configured;
  }

  async function appendLogLine(line: string) {
    if (!filePath) return;
    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, `${line}\n`, "utf8");
  }

  return {
    log(level: LogLevel, event: string, details: Record<string, unknown> = {}) {
      if (!shouldLog(level)) return;
      const payload = {
        ts: new Date().toISOString(),
        level,
        event,
        ...details,
      };
      const line = `[${prefix}] ${JSON.stringify(payload)}`;
      console.error(line);
      if (filePath) {
        void appendLogLine(line);
      }
    },
  };
}
