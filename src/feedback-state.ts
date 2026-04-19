import type { ImageAttachment, PersistedFeedbackState } from "./session-state-store.js";

const MAX_SESSION_HISTORY = 50;

export type PendingFeedbackResult =
  | { type: "feedback"; content: string; images?: ImageAttachment[] }
  | { type: "closed"; reason: string };

export type PendingWaiter = {
  waitId: string;
  startedAt: string;
  requestId: string;
  resolve: (result: PendingFeedbackResult) => void;
};

export type FeedbackChannelState = {
  pendingWaiter: PendingWaiter | null;
  queuedFeedback: string | null;
  queuedImages: ImageAttachment[] | null;
  queuedAt: string | null;
  urgentFeedback: string | null;
  urgentImages: ImageAttachment[] | null;
  urgentAt: string | null;
  latestFeedback: string;
  history: {
    role: "user";
    content: string;
    images?: ImageAttachment[];
    createdAt: string;
  }[];
  remoteEnabled: boolean;
  agentContext: string | null;
  agentContextSource: "assistant" | "fyi" | null;
};

type FeedbackStateDependencies = {
  onStateChange(sessionId?: string): void;
  markActivity(sessionId: string, reason: string): void;
  markDisconnected(sessionId: string, reason: string): void;
  log(
    level: "debug" | "info" | "warn" | "error",
    event: string,
    details: Record<string, unknown>
  ): void;
  persistFeedbackState(sessionId: string, state: PersistedFeedbackState): Promise<void>;
};

export class FeedbackStateManager {
  private feedbackState = new Map<string, FeedbackChannelState>();

  constructor(private deps: FeedbackStateDependencies) {}

  hydrate(feedbackBySession: Record<string, PersistedFeedbackState>): void {
    for (const [sessionId, persisted] of Object.entries(feedbackBySession)) {
      this.feedbackState.set(sessionId, {
        pendingWaiter: null,
        queuedFeedback: persisted.queuedFeedback,
        queuedImages: persisted.queuedImages ?? null,
        queuedAt: persisted.queuedAt,
        urgentFeedback: persisted.urgentFeedback ?? null,
        urgentImages: persisted.urgentImages ?? null,
        urgentAt: persisted.urgentAt ?? null,
        latestFeedback: persisted.latestFeedback,
        history: Array.isArray(persisted.history) ? persisted.history : [],
        remoteEnabled: persisted.remoteEnabled === true,
        agentContext: null,
        agentContextSource: null,
      });
    }
  }

  size(): number {
    return this.feedbackState.size;
  }

  getRemoteEnabledSessions(): string[] {
    return Array.from(this.feedbackState.entries())
      .filter(([, state]) => state.remoteEnabled)
      .map(([sessionId]) => sessionId);
  }

  getExistingState(sessionId: string): FeedbackChannelState | undefined {
    return this.feedbackState.get(sessionId);
  }

  delete(sessionId: string): void {
    this.feedbackState.delete(sessionId);
  }

  getFeedbackState(sessionId: string): FeedbackChannelState {
    const existing = this.feedbackState.get(sessionId);
    if (existing) return existing;

    const created: FeedbackChannelState = {
      pendingWaiter: null,
      queuedFeedback: null,
      queuedImages: null,
      queuedAt: null,
      urgentFeedback: null,
      urgentImages: null,
      urgentAt: null,
      latestFeedback: "",
      history: [],
      remoteEnabled: false,
      agentContext: null,
      agentContextSource: null,
    };
    this.feedbackState.set(sessionId, created);
    this.deps.log("debug", "feedback.state.created", { sessionId });
    return created;
  }

  isWaiting(sessionId: string): boolean {
    const state = this.feedbackState.get(sessionId);
    return Boolean(state?.pendingWaiter);
  }

  setRemoteEnabled(sessionId: string, enabled: boolean): void {
    const state = this.getFeedbackState(sessionId);
    state.remoteEnabled = enabled;
    this.persistFeedbackState(sessionId).catch((err) => {
      this.deps.log("error", "session.remote.persist_failed", { sessionId, error: String(err) });
    });
    this.deps.onStateChange(sessionId);
    this.deps.log("info", "session.remote.toggled", { sessionId, enabled });
  }

  isRemoteEnabled(sessionId: string): boolean {
    const state = this.feedbackState.get(sessionId);
    return state?.remoteEnabled ?? false;
  }

  setAgentContext(sessionId: string, context: string | null, source: "assistant" | "fyi" = "assistant"): void {
    const state = this.getFeedbackState(sessionId);
    state.agentContext = context;
    state.agentContextSource = context !== null ? source : null;
    if (context !== null) {
      this.deps.markActivity(sessionId, "agent_context");
    }
    this.deps.onStateChange(sessionId);
  }

  getAgentContext(sessionId: string): string | null {
    return this.feedbackState.get(sessionId)?.agentContext ?? null;
  }

  getAgentContextSource(sessionId: string): "assistant" | "fyi" | null {
    return this.feedbackState.get(sessionId)?.agentContextSource ?? null;
  }

  hasQueuedFeedback(sessionId: string): boolean {
    const state = this.feedbackState.get(sessionId);
    return Boolean(state?.queuedFeedback);
  }

  setWaiter(sessionId: string, waiter: PendingWaiter): void {
    const state = this.getFeedbackState(sessionId);
    state.pendingWaiter = waiter;
    this.deps.markActivity(sessionId, "feedback_request");
    void this.persistFeedbackState(sessionId);
    this.deps.onStateChange(sessionId);
  }

  async clearPendingWaiter(sessionId: string, reason: string, expectedRequestId?: string): Promise<void> {
    const state = this.feedbackState.get(sessionId);
    if (!state || !state.pendingWaiter) return;

    const waiter = state.pendingWaiter;
    if (expectedRequestId && waiter.requestId !== expectedRequestId) return;

    state.pendingWaiter = null;
    await this.persistFeedbackState(sessionId);
    this.deps.onStateChange(sessionId);

    waiter.resolve({ type: "closed", reason });

    this.deps.log("warn", "feedback.waiter.cleared", {
      sessionId,
      reason,
      requestId: waiter.requestId,
      waitId: waiter.waitId,
      waitStartedAt: waiter.startedAt,
      waitDurationMs: Date.now() - Date.parse(waiter.startedAt),
    });

    const disconnectReasons = ["request_aborted", "response_disconnected", "stream_closed", "client_disconnected"];
    if (disconnectReasons.includes(reason)) {
      this.deps.markDisconnected(sessionId, reason);
    }
  }

  async deliverFeedback(
    sessionId: string,
    content: string,
    images?: ImageAttachment[]
  ): Promise<{ delivered: boolean; queued: boolean }> {
    const state = this.getFeedbackState(sessionId);
    const queuedAt = new Date().toISOString();

    state.latestFeedback = content;
    this.deps.log("debug", "feedback.received", {
      sessionId,
      contentLength: content.length,
      imageCount: images?.length ?? 0,
      hasPendingWaiter: Boolean(state.pendingWaiter),
    });

    if (state.pendingWaiter) {
      const waiter = state.pendingWaiter;
      state.pendingWaiter = null;
      state.queuedAt = null;
      state.queuedImages = null;
      await this.persistFeedbackState(sessionId);
      this.deps.onStateChange(sessionId);

      waiter.resolve({ type: "feedback", content, images });
      this.deps.markActivity(sessionId, "feedback_delivered");

      this.deps.log("info", "feedback.delivered", {
        sessionId,
        waitId: waiter.waitId,
        contentLength: content.length,
        imageCount: images?.length ?? 0,
        waitDurationMs: Date.now() - Date.parse(waiter.startedAt),
      });

      return { delivered: true, queued: false };
    }

    state.queuedFeedback = content;
    state.queuedImages = images && images.length > 0 ? images : null;
    state.queuedAt = queuedAt;
    await this.persistFeedbackState(sessionId);
    this.deps.onStateChange(sessionId);

    this.deps.log("info", "feedback.queued", {
      sessionId,
      contentLength: content.length,
      imageCount: images?.length ?? 0,
    });

    return { delivered: false, queued: true };
  }

  consumeQueuedFeedback(sessionId: string): { content: string; images?: ImageAttachment[] } | null {
    const state = this.feedbackState.get(sessionId);
    if (!state || state.queuedFeedback === null) return null;

    const content = state.queuedFeedback;
    const images = state.queuedImages ?? undefined;

    state.queuedFeedback = null;
    state.queuedImages = null;
    state.queuedAt = null;

    void this.persistFeedbackState(sessionId);
    this.deps.markActivity(sessionId, "queued_feedback_consumed");
    this.deps.onStateChange(sessionId);

    this.deps.log("info", "feedback.queued.consumed", {
      sessionId,
      contentLength: content.length,
      imageCount: images?.length ?? 0,
    });

    return { content, images };
  }

  clearQueuedFeedback(sessionId: string): boolean {
    const state = this.feedbackState.get(sessionId);
    if (!state || state.queuedFeedback === null) return false;

    state.queuedFeedback = null;
    state.queuedImages = null;
    state.queuedAt = null;

    void this.persistFeedbackState(sessionId);
    this.deps.onStateChange(sessionId);

    this.deps.log("info", "feedback.queued.cancelled", { sessionId });

    return true;
  }

  async queueUrgentFeedback(
    sessionId: string,
    content: string,
    images?: ImageAttachment[]
  ): Promise<{ delivered: boolean; queued: boolean }> {
    const state = this.getFeedbackState(sessionId);

    if (state.pendingWaiter) {
      const waiter = state.pendingWaiter;
      state.pendingWaiter = null;
      state.queuedAt = null;
      state.queuedImages = null;
      await this.persistFeedbackState(sessionId);
      this.deps.onStateChange(sessionId);

      waiter.resolve({ type: "feedback", content: `[URGENT] ${content}`, images });
      this.deps.markActivity(sessionId, "urgent_feedback_delivered");

      this.deps.log("info", "feedback.urgent.delivered", {
        sessionId,
        waitId: waiter.waitId,
        contentLength: content.length,
        imageCount: images?.length ?? 0,
      });

      return { delivered: true, queued: false };
    }

    state.urgentFeedback = content;
    state.urgentImages = images && images.length > 0 ? images : null;
    state.urgentAt = new Date().toISOString();
    await this.persistFeedbackState(sessionId);
    this.deps.onStateChange(sessionId);

    this.deps.log("info", "feedback.urgent.queued", {
      sessionId,
      contentLength: content.length,
      imageCount: images?.length ?? 0,
    });

    return { delivered: false, queued: true };
  }

  consumeUrgentFeedback(sessionId: string): { content: string; images?: ImageAttachment[] } | null {
    const state = this.feedbackState.get(sessionId);
    if (!state || state.urgentFeedback === null) return null;

    const content = state.urgentFeedback;
    const images = state.urgentImages ?? undefined;

    state.urgentFeedback = null;
    state.urgentImages = null;
    state.urgentAt = null;

    void this.persistFeedbackState(sessionId);
    this.deps.markActivity(sessionId, "urgent_feedback_consumed");
    this.deps.onStateChange(sessionId);

    this.deps.log("info", "feedback.urgent.consumed", {
      sessionId,
      contentLength: content.length,
      imageCount: images?.length ?? 0,
    });

    return { content, images };
  }

  hasUrgentFeedback(sessionId: string): boolean {
    const state = this.feedbackState.get(sessionId);
    return state?.urgentFeedback !== null && state?.urgentFeedback !== undefined;
  }

  clearUrgentFeedback(sessionId: string): boolean {
    const state = this.feedbackState.get(sessionId);
    if (!state || state.urgentFeedback === null) return false;

    state.urgentFeedback = null;
    state.urgentImages = null;
    state.urgentAt = null;

    void this.persistFeedbackState(sessionId);
    this.deps.onStateChange(sessionId);

    this.deps.log("info", "feedback.urgent.cancelled", { sessionId });

    return true;
  }

  appendHistory(sessionId: string, content: string, images?: ImageAttachment[]): void {
    const state = this.getFeedbackState(sessionId);
    state.history.push({
      role: "user",
      content,
      images,
      createdAt: new Date().toISOString(),
    });

    while (state.history.length > MAX_SESSION_HISTORY) {
      state.history.shift();
    }

    void this.persistFeedbackState(sessionId);
  }

  private async persistFeedbackState(sessionId: string): Promise<void> {
    const state = this.feedbackState.get(sessionId);
    if (!state) return;

    const persisted: PersistedFeedbackState = {
      queuedFeedback: state.queuedFeedback,
      queuedImages: state.queuedImages,
      queuedAt: state.queuedAt,
      urgentFeedback: state.urgentFeedback,
      urgentImages: state.urgentImages,
      urgentAt: state.urgentAt,
      latestFeedback: state.latestFeedback,
      history: state.history,
      remoteEnabled: state.remoteEnabled,
    };

    await this.deps.persistFeedbackState(sessionId, persisted);
  }
}
