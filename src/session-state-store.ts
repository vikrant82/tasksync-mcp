import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type ImageAttachment = {
  data: string; // base64-encoded image data
  mimeType: string; // e.g. "image/png", "image/jpeg"
};

export type PersistedFeedbackState = {
  queuedFeedback: string | null;
  queuedImages?: ImageAttachment[] | null;
  queuedAt: string | null;
  latestFeedback: string;
  history: {
    role: "user";
    content: string;
    images?: ImageAttachment[];
    createdAt: string;
  }[];
  remoteEnabled?: boolean;
};

export type PersistedSessionMetadata = {
  sessionId: string;
  transportId: string;
  clientAlias: string;
  clientGeneration: number | null;
  createdAt: string;
  lastSeenAt: string;
  lastActivityAt: string;
  disconnectedAt: string | null;
  status: "active" | "disconnected" | "closed";
};

export type PersistedSettings = {
  disconnectAfterMinutes: number;
};

export type PersistedTaskSyncState = {
  version: 1;
  activeUiSessionId: string;
  settings: PersistedSettings;
  feedbackBySession: Record<string, PersistedFeedbackState>;
  sessionMetadataById: Record<string, PersistedSessionMetadata>;
  manualAliasBySession: Record<string, string>;
  inferredAliasBySession: Record<string, string>;
  clientGenerationByAlias: Record<string, number>;
};

const DEFAULT_PERSISTED_STATE: PersistedTaskSyncState = {
  version: 1,
  activeUiSessionId: "__default__",
  settings: {
    disconnectAfterMinutes: 0,
  },
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

const VALID_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function sanitizeImageAttachments(raw: unknown[]): ImageAttachment[] {
  return raw
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
    .filter((item) => typeof item.data === "string" && typeof item.mimeType === "string" && VALID_IMAGE_MIME_TYPES.has(item.mimeType))
    .map((item) => ({ data: item.data as string, mimeType: item.mimeType as string }));
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
            queuedImages: Array.isArray(persisted.queuedImages) ? sanitizeImageAttachments(persisted.queuedImages) : null,
            queuedAt: typeof persisted.queuedAt === "string" ? persisted.queuedAt : null,
            latestFeedback: typeof persisted.latestFeedback === "string" ? persisted.latestFeedback : "",
            history: Array.isArray(persisted.history)
              ? persisted.history
                  .map((entry) => {
                    const item = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
                    return {
                      role: "user" as const,
                      content: typeof item.content === "string" ? item.content : "",
                      images: Array.isArray(item.images) ? sanitizeImageAttachments(item.images) : undefined,
                      createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
                    };
                  })
                  .filter((entry) => entry.content.length > 0 || (entry.images && entry.images.length > 0))
              : [],
            remoteEnabled: persisted.remoteEnabled === true,
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
        const lastActivityAt = typeof persisted.lastActivityAt === "string" ? persisted.lastActivityAt : "";
        const rawStatus = persisted.status;
        const status = rawStatus === "closed" ? "closed" : rawStatus === "disconnected" ? "disconnected" : "active";
        return [
          sessionId,
          {
            sessionId,
            transportId: typeof persisted.transportId === "string" ? persisted.transportId : "",
            clientAlias: typeof persisted.clientAlias === "string" ? persisted.clientAlias : "",
            clientGeneration: typeof persisted.clientGeneration === "number" ? persisted.clientGeneration : null,
            createdAt: typeof persisted.createdAt === "string" ? persisted.createdAt : "",
            lastSeenAt: typeof persisted.lastSeenAt === "string" ? persisted.lastSeenAt : lastActivityAt,
            lastActivityAt,
            disconnectedAt: typeof persisted.disconnectedAt === "string" ? persisted.disconnectedAt : null,
            status,
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

  private sanitizeSettings(raw: unknown): PersistedSettings {
    const parsed = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const disconnectAfterMinutes = typeof parsed.disconnectAfterMinutes === "number"
      && Number.isFinite(parsed.disconnectAfterMinutes)
      && parsed.disconnectAfterMinutes >= 0
      ? Math.floor(parsed.disconnectAfterMinutes)
      : DEFAULT_PERSISTED_STATE.settings.disconnectAfterMinutes;

    return { disconnectAfterMinutes };
  }

  async load(): Promise<PersistedTaskSyncState> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      this.state = {
        version: 1,
        activeUiSessionId:
          typeof parsed.activeUiSessionId === "string" ? parsed.activeUiSessionId : DEFAULT_PERSISTED_STATE.activeUiSessionId,
        settings: this.sanitizeSettings(parsed.settings),
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

  async setDisconnectAfterMinutes(minutes: number): Promise<void> {
    const normalized = Number.isFinite(minutes) && minutes >= 0
      ? Math.floor(minutes)
      : DEFAULT_PERSISTED_STATE.settings.disconnectAfterMinutes;
    this.state.settings.disconnectAfterMinutes = normalized;
    await this.save();
  }
}
