import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type PersistedFeedbackState = {
  queuedFeedback: string | null;
  queuedAt: string | null;
  latestFeedback: string;
  history: {
    role: "user";
    content: string;
    createdAt: string;
  }[];
};

export type PersistedSessionMetadata = {
  sessionId: string;
  transportId: string;
  clientAlias: string;
  clientGeneration: number | null;
  createdAt: string;
  lastActivityAt: string;
  status: "active" | "closed";
};

export type PersistedTaskSyncState = {
  version: 1;
  activeUiSessionId: string;
  feedbackBySession: Record<string, PersistedFeedbackState>;
  sessionMetadataById: Record<string, PersistedSessionMetadata>;
  manualAliasBySession: Record<string, string>;
  inferredAliasBySession: Record<string, string>;
  clientGenerationByAlias: Record<string, number>;
};

const DEFAULT_PERSISTED_STATE: PersistedTaskSyncState = {
  version: 1,
  activeUiSessionId: "__default__",
  feedbackBySession: {},
  sessionMetadataById: {},
  manualAliasBySession: {},
  inferredAliasBySession: {},
  clientGenerationByAlias: {},
};

function cloneState(state: PersistedTaskSyncState): PersistedTaskSyncState {
  return JSON.parse(JSON.stringify(state)) as PersistedTaskSyncState;
}

function cloneFeedbackState(state: PersistedFeedbackState): PersistedFeedbackState {
  return JSON.parse(JSON.stringify(state)) as PersistedFeedbackState;
}

export class SessionStateStore {
  private readonly filePath: string;
  private state: PersistedTaskSyncState = cloneState(DEFAULT_PERSISTED_STATE);

  constructor(filePath = path.join(process.cwd(), ".tasksync", "session-state.json")) {
    this.filePath = filePath;
  }

  private sanitizeFeedbackBySession(raw: unknown): Record<string, PersistedFeedbackState> {
    if (!raw || typeof raw !== "object") return {};
    return Object.fromEntries(
      Object.entries(raw).map(([sessionId, value]) => {
        const persisted = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
        return [
          sessionId,
          {
            queuedFeedback: typeof persisted.queuedFeedback === "string" ? persisted.queuedFeedback : null,
            queuedAt: typeof persisted.queuedAt === "string" ? persisted.queuedAt : null,
            latestFeedback: typeof persisted.latestFeedback === "string" ? persisted.latestFeedback : "",
            history: Array.isArray(persisted.history)
              ? persisted.history
                  .map((entry) => {
                    const item = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
                    return {
                      role: "user" as const,
                      content: typeof item.content === "string" ? item.content : "",
                      createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
                    };
                  })
                  .filter((entry) => entry.content.length > 0)
              : [],
          },
        ];
      })
    );
  }

  private sanitizeSessionMetadata(raw: unknown): Record<string, PersistedSessionMetadata> {
    if (!raw || typeof raw !== "object") return {};
    return Object.fromEntries(
      Object.entries(raw).map(([sessionId, value]) => {
        const persisted = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
        return [
          sessionId,
          {
            sessionId,
            transportId: typeof persisted.transportId === "string" ? persisted.transportId : "",
            clientAlias: typeof persisted.clientAlias === "string" ? persisted.clientAlias : "",
            clientGeneration: typeof persisted.clientGeneration === "number" ? persisted.clientGeneration : null,
            createdAt: typeof persisted.createdAt === "string" ? persisted.createdAt : "",
            lastActivityAt: typeof persisted.lastActivityAt === "string" ? persisted.lastActivityAt : "",
            status: persisted.status === "closed" ? "closed" : "active",
          },
        ];
      })
    );
  }

  private sanitizeStringRecord(raw: unknown): Record<string, string> {
    if (!raw || typeof raw !== "object") return {};
    return Object.fromEntries(Object.entries(raw).filter(([, value]) => typeof value === "string")) as Record<string, string>;
  }

  private sanitizeNumberRecord(raw: unknown): Record<string, number> {
    if (!raw || typeof raw !== "object") return {};
    return Object.fromEntries(Object.entries(raw).filter(([, value]) => typeof value === "number")) as Record<string, number>;
  }

  async load(): Promise<PersistedTaskSyncState> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      this.state = {
        version: 1,
        activeUiSessionId:
          typeof parsed.activeUiSessionId === "string" ? parsed.activeUiSessionId : DEFAULT_PERSISTED_STATE.activeUiSessionId,
        feedbackBySession: this.sanitizeFeedbackBySession(parsed.feedbackBySession),
        sessionMetadataById: this.sanitizeSessionMetadata(parsed.sessionMetadataById),
        manualAliasBySession: this.sanitizeStringRecord(parsed.manualAliasBySession),
        inferredAliasBySession: this.sanitizeStringRecord(parsed.inferredAliasBySession),
        clientGenerationByAlias: this.sanitizeNumberRecord(parsed.clientGenerationByAlias),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("ENOENT")) {
        throw error;
      }
      this.state = cloneState(DEFAULT_PERSISTED_STATE);
    }

    return this.getSnapshot();
  }

  getSnapshot(): PersistedTaskSyncState {
    return cloneState(this.state);
  }

  async save(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
  }

  async setActiveUiSessionId(sessionId: string): Promise<void> {
    this.state.activeUiSessionId = sessionId;
    await this.save();
  }

  async saveFeedbackState(sessionId: string, feedbackState: PersistedFeedbackState): Promise<void> {
    this.state.feedbackBySession[sessionId] = cloneFeedbackState(feedbackState);
    await this.save();
  }

  async saveSessionMetadata(sessionId: string, metadata: PersistedSessionMetadata): Promise<void> {
    this.state.sessionMetadataById[sessionId] = { ...metadata, sessionId };
    await this.save();
  }

  async markSessionClosed(sessionId: string): Promise<void> {
    const existing = this.state.sessionMetadataById[sessionId];
    if (existing) {
      this.state.sessionMetadataById[sessionId] = {
        ...existing,
        status: "closed",
        lastActivityAt: new Date().toISOString(),
      };
    }
    await this.save();
  }

  async deleteSession(sessionId: string): Promise<void> {
    delete this.state.sessionMetadataById[sessionId];
    delete this.state.feedbackBySession[sessionId];
    delete this.state.manualAliasBySession[sessionId];
    delete this.state.inferredAliasBySession[sessionId];
    if (this.state.activeUiSessionId === sessionId) {
      this.state.activeUiSessionId = "__default__";
    }
    await this.save();
  }

  async setManualAlias(sessionId: string, alias: string | null): Promise<void> {
    if (alias) {
      this.state.manualAliasBySession[sessionId] = alias;
    } else {
      delete this.state.manualAliasBySession[sessionId];
    }
    await this.save();
  }

  async setInferredAlias(sessionId: string, alias: string | null): Promise<void> {
    if (alias) {
      this.state.inferredAliasBySession[sessionId] = alias;
    } else {
      delete this.state.inferredAliasBySession[sessionId];
    }
    await this.save();
  }

  async setClientGeneration(alias: string, generation: number): Promise<void> {
    this.state.clientGenerationByAlias[alias] = generation;
    await this.save();
  }
}
