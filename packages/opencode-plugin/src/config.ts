import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface TaskSyncPluginConfig {
  /** Port for the feedback web UI. Default: 4596 */
  uiPort: number;
  /** Whether to auto-open browser when UI starts. Default: true */
  openBrowser: boolean;
  /** Log level. Default: "info" */
  logLevel: "debug" | "info" | "warn" | "error";
  /** Path to log file. Default: undefined (no file logging) */
  logFile?: string;
  /**
   * Which agents to augment with the daemon feedback loop overlay.
   * - `[]` (default) — no augmentation, only the dedicated `daemon` agent gets the loop
   * - `["coder"]` — augment only the `coder` agent
   * - `["coder", "ask"]` — augment specific agents
   * - `["*"]` — augment ALL agents (except the dedicated `daemon` agent)
   */
  augmentAgents: string[];
  /**
   * Style of the daemon overlay injected into augmented agents.
   * - `"full"` (default) — comprehensive protocol (~120 lines), same depth as standalone daemon prompt
   * - `"compact"` — condensed core rules only (~50 lines)
   */
  overlayStyle: "full" | "compact";
}

const DEFAULTS: TaskSyncPluginConfig = {
  uiPort: 4596,
  openBrowser: true,
  logLevel: "info",
  logFile: undefined,
  augmentAgents: [],
  overlayStyle: "full",
};

const CONFIG_FILENAME = ".tasksync/config.json";

/**
 * Load plugin configuration from `.tasksync/config.json` in the project
 * directory, with environment variable overrides applied on top.
 *
 * Env var mapping:
 *   TASKSYNC_UI_PORT        → uiPort
 *   TASKSYNC_NO_BROWSER=1   → openBrowser = false
 *   TASKSYNC_LOG_LEVEL      → logLevel
 *   TASKSYNC_LOG_FILE       → logFile
 *   TASKSYNC_AUGMENT_AGENTS → augmentAgents (comma-separated, e.g. "coder,ask" or "*")
 *   TASKSYNC_OVERLAY_STYLE  → overlayStyle
 */
export function loadConfig(projectDir: string): TaskSyncPluginConfig {
  const config: TaskSyncPluginConfig = { ...DEFAULTS };

  const configPath = resolve(projectDir, CONFIG_FILENAME);
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf-8");
      const file = JSON.parse(raw) as Partial<TaskSyncPluginConfig>;
      if (typeof file.uiPort === "number") config.uiPort = file.uiPort;
      if (typeof file.openBrowser === "boolean") config.openBrowser = file.openBrowser;
      if (typeof file.logLevel === "string" && ["debug", "info", "warn", "error"].includes(file.logLevel)) {
        config.logLevel = file.logLevel as TaskSyncPluginConfig["logLevel"];
      }
      if (typeof file.logFile === "string") config.logFile = file.logFile;
      if (Array.isArray(file.augmentAgents)) {
        config.augmentAgents = file.augmentAgents.filter((a): a is string => typeof a === "string");
      }
      if (typeof file.overlayStyle === "string" && ["full", "compact"].includes(file.overlayStyle)) {
        config.overlayStyle = file.overlayStyle as TaskSyncPluginConfig["overlayStyle"];
      }
    } catch {
      // Malformed config file — fall through to defaults + env overrides
    }
  }

  // Environment variable overrides (highest precedence)
  const envPort = parseInt(process.env.TASKSYNC_UI_PORT || "", 10);
  if (!isNaN(envPort) && envPort > 0) config.uiPort = envPort;

  if (process.env.TASKSYNC_NO_BROWSER === "1") config.openBrowser = false;

  const envLevel = process.env.TASKSYNC_LOG_LEVEL;
  if (envLevel && ["debug", "info", "warn", "error"].includes(envLevel)) {
    config.logLevel = envLevel as TaskSyncPluginConfig["logLevel"];
  }

  if (process.env.TASKSYNC_LOG_FILE) config.logFile = process.env.TASKSYNC_LOG_FILE;

  const envAugment = process.env.TASKSYNC_AUGMENT_AGENTS;
  if (envAugment !== undefined) {
    config.augmentAgents = envAugment
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const envOverlay = process.env.TASKSYNC_OVERLAY_STYLE;
  if (envOverlay && ["full", "compact"].includes(envOverlay)) {
    config.overlayStyle = envOverlay as TaskSyncPluginConfig["overlayStyle"];
  }

  return config;
}
