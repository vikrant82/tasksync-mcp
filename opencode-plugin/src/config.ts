import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

export interface TaskSyncPluginConfig {
  /** URL of the TaskSync server (UI port). Default: http://localhost:3456 */
  serverUrl: string;
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
  serverUrl: "http://localhost:3456",
  augmentAgents: [],
  overlayStyle: "full",
};

/**
 * Try to read a JSON config file and return its contents.
 * Returns null if file doesn't exist or is malformed.
 */
function readConfigFile(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed JSON — ignore
  }
  return null;
}

/**
 * Apply config values from a settings object onto the config.
 */
function applySettings(config: TaskSyncPluginConfig, settings: Record<string, unknown>): void {
  if (typeof settings.serverUrl === "string") config.serverUrl = settings.serverUrl;
  if (Array.isArray(settings.augmentAgents)) {
    config.augmentAgents = settings.augmentAgents.filter((a): a is string => typeof a === "string");
  }
  if (typeof settings.overlayStyle === "string" && ["full", "compact"].includes(settings.overlayStyle)) {
    config.overlayStyle = settings.overlayStyle as TaskSyncPluginConfig["overlayStyle"];
  }
}

/**
 * Load plugin configuration with the following precedence (highest wins):
 *
 * 1. Environment variables (TASKSYNC_SERVER_URL, TASKSYNC_AUGMENT_AGENTS, TASKSYNC_OVERLAY_STYLE)
 * 2. Project-level `.tasksync/config.json`
 * 3. Global `~/.tasksync/config.json`
 * 4. Defaults
 *
 * Example `.tasksync/config.json`:
 * ```json
 * {
 *   "serverUrl": "http://localhost:3456",
 *   "augmentAgents": ["coder"],
 *   "overlayStyle": "full"
 * }
 * ```
 */
export function loadConfig(projectDir: string): TaskSyncPluginConfig {
  const config: TaskSyncPluginConfig = { ...DEFAULTS };

  // Layer 1: Global ~/.tasksync/config.json (lowest precedence after defaults)
  const globalConfig = readConfigFile(
    resolve(homedir(), ".tasksync", "config.json")
  );
  if (globalConfig) applySettings(config, globalConfig);

  // Layer 2: Project-level .tasksync/config.json (overrides global)
  const projectConfig = readConfigFile(resolve(projectDir, ".tasksync", "config.json"));
  if (projectConfig) applySettings(config, projectConfig);

  // Layer 3: Environment variable overrides (highest precedence)
  if (process.env.TASKSYNC_SERVER_URL) config.serverUrl = process.env.TASKSYNC_SERVER_URL;

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
