/**
 * Session Manager - Centralized session lifecycle and state management.
 *
 * This module is the single source of truth for session state.
 * All session-related operations should go through these APIs.
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SessionStateStore, type ImageAttachment, type PersistedFeedbackState } from "./session-state-store.js";

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_SESSION_ID = "__default__";
const DEFAULT_DISCONNECT_AFTER_MINUTES = 20;
const MIN_DISCONNECT_AFTER_MINUTES = 1;
const MAX_DISCONNECT_AFTER_MINUTES = 24 * 60; // 1 day
const AUTO_PRUNE_INTERVAL_MS = 60 * 1000; // Check every minute
const MAX_SESSION_HISTORY = 50;

// ============================================================================
// TYPES
// ============================================================================

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
  latestFeedback: string;
  history: {
    role: "user";
    content: string;
    images?: ImageAttachment[];
    createdAt: string;
  }[];
  remoteEnabled: boolean;
  agentContext: string | null;
};

export type StreamableSessionEntry = {
  transport?: StreamableHTTPServerTransport;
  server?: Server;
  transportId: string;
  clientAlias: string;
  clientGeneration: number | null;
  createdAt: string;
  lastActivityAt: string;
  status: "active" | "closed";
};

export type PendingFeedbackResult =
  | { type: "feedback"; content: string; images?: ImageAttachment[] }
  | { type: "closed"; reason: string };

export type SessionInfo = {
  sessionId: string;
  alias: string;
  createdAt: string;
  lastActivityAt: string;
  status: "active" | "closed";
  isWaiting: boolean;
  waitStartedAt: string | null;
  hasQueuedFeedback: boolean;
  remoteEnabled: boolean;
};

export type SessionManagerEvents = {
  onStateChange: (sessionId?: string) => void;
  onLog: (level: "debug" | "info" | "warn" | "error", event: string, details: Record<string, unknown>) => void;
};

// ============================================================================
// SESSION MANAGER CLASS
// ============================================================================

export class SessionManager {
  private sessions = new Map<string, StreamableSessionEntry>();
  private feedbackState = new Map<string, FeedbackChannelState>();
  private manualAliases = new Map<string, string>();
  private inferredAliases = new Map<string, string>();
  private clientGenerations = new Map<string, number>();
  private activeUiSessionId = DEFAULT_SESSION_ID;
  private pruneIntervalId: NodeJS.Timeout | null = null;

  constructor(
    private store: SessionStateStore,
    private events: SessionManagerEvents
  ) {}

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  async initialize(): Promise<void> {
    await this.store.load();
    await this.hydrateFromStore();
    this.startAutoPrune();
  }

  private async hydrateFromStore(): Promise<void> {
    const snapshot = this.store.getSnapshot();

    // Restore active UI session
    this.activeUiSessionId = snapshot.activeUiSessionId || DEFAULT_SESSION_ID;

    // Restore aliases
    for (const [sessionId, alias] of Object.entries(snapshot.manualAliasBySession)) {
      this.manualAliases.set(sessionId, alias);
    }

    // Restore client generations
    for (const [alias, gen] of Object.entries(snapshot.clientGenerationByAlias)) {
      this.clientGenerations.set(alias, gen);
    }

    // Restore feedback state (but NOT session entries - those require live transport)
    for (const [sessionId, persisted] of Object.entries(snapshot.feedbackBySession)) {
      this.feedbackState.set(sessionId, {
        pendingWaiter: null, // Can't restore pending waiters across restart
        queuedFeedback: persisted.queuedFeedback,
        queuedImages: persisted.queuedImages ?? null,
        queuedAt: persisted.queuedAt,
        latestFeedback: persisted.latestFeedback,
        history: Array.isArray(persisted.history) ? persisted.history : [],
        remoteEnabled: persisted.remoteEnabled === true,
        agentContext: null,
      });
    }

    this.log("info", "session-manager.hydrated", {
      sessionCount: Object.keys(snapshot.sessionMetadataById).length,
      feedbackStateCount: this.feedbackState.size,
      activeUiSessionId: this.activeUiSessionId,
      remoteEnabledSessions: Array.from(this.feedbackState.entries())
        .filter(([, s]) => s.remoteEnabled)
        .map(([id]) => id),
    });
  }

  shutdown(): void {
    if (this.pruneIntervalId) {
      clearInterval(this.pruneIntervalId);
      this.pruneIntervalId = null;
    }
  }

  // ==========================================================================
  // SESSION LIFECYCLE
  // ==========================================================================

  createSession(
    sessionId: string,
    transport: StreamableHTTPServerTransport | undefined,
    server: Server | undefined,
    transportId: string,
    clientAlias: string,
    clientGeneration: number | null
  ): StreamableSessionEntry {
    const now = new Date().toISOString();
    const entry: StreamableSessionEntry = {
      transport,
      server,
      transportId,
      clientAlias,
      clientGeneration,
      createdAt: now,
      lastActivityAt: now,
      status: "active",
    };

    this.sessions.set(sessionId, entry);
    this.events.onStateChange(sessionId);

    this.log("info", "session.created", {
      sessionId,
      transportId,
      clientAlias,
      clientGeneration,
      activeSessions: this.sessions.size,
    });

    // Persist session metadata
    this.persistSessionMetadata(sessionId, entry);

    return entry;
  }

  getSession(sessionId: string): StreamableSessionEntry | undefined {
    return this.sessions.get(sessionId);
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  getAllSessions(): Map<string, StreamableSessionEntry> {
    return new Map(this.sessions);
  }

  getLiveSessions(): SessionInfo[] {
    return Array.from(this.sessions.entries()).map(([sessionId, entry]) => {
      const state = this.feedbackState.get(sessionId);
      return {
        sessionId,
        alias: this.getSessionAlias(sessionId),
        createdAt: entry.createdAt,
        lastActivityAt: entry.lastActivityAt,
        status: entry.status,
        isWaiting: Boolean(state?.pendingWaiter),
        waitStartedAt: state?.pendingWaiter?.startedAt ?? null,
        hasQueuedFeedback: Boolean(state?.queuedFeedback),
        remoteEnabled: state?.remoteEnabled ?? false,
      };
    });
  }

  async closeSession(sessionId: string, reason: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;

    entry.status = "closed";

    // Clear any pending waiter
    await this.clearPendingWaiter(sessionId, reason);

    // Close transport (if present — external sessions have no transport)
    try {
      if (entry.transport) {
        await entry.transport.close();
      }
    } catch (err) {
      this.log("error", "session.close.transport_error", { sessionId, error: String(err) });
    }

    this.log("info", "session.closed", {
      sessionId,
      reason,
      transportId: entry.transportId,
      clientAlias: entry.clientAlias,
    });

    this.events.onStateChange(sessionId);
  }

  async deleteSession(sessionId: string, reason: string): Promise<void> {
    await this.closeSession(sessionId, reason);

    this.sessions.delete(sessionId);
    this.feedbackState.delete(sessionId);
    this.manualAliases.delete(sessionId);
    this.inferredAliases.delete(sessionId);

    // Update active UI session if needed
    if (this.activeUiSessionId === sessionId) {
      this.activeUiSessionId = DEFAULT_SESSION_ID;
      await this.store.setActiveUiSessionId(DEFAULT_SESSION_ID);
    }

    await this.store.deleteSession(sessionId);
    this.events.onStateChange();

    this.log("info", "session.deleted", { sessionId, reason });
  }

  // ==========================================================================
  // ACTIVITY TRACKING
  // ==========================================================================

  /**
   * Mark a session as having meaningful activity.
   * This resets the prune timer.
   *
   * Call this when:
   * - get_feedback is called
   * - Feedback is delivered to session
   * - UI submits feedback for this session
   */
  markActivity(sessionId: string, reason: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;

    const now = new Date().toISOString();
    entry.lastActivityAt = now;

    this.log("debug", "session.activity", { sessionId, reason });
    this.persistSessionMetadata(sessionId, entry);
  }

  // ==========================================================================
  // FEEDBACK STATE
  // ==========================================================================

  getFeedbackState(sessionId: string): FeedbackChannelState {
    const existing = this.feedbackState.get(sessionId);
    if (existing) return existing;

    const created: FeedbackChannelState = {
      pendingWaiter: null,
      queuedFeedback: null,
      queuedImages: null,
      queuedAt: null,
      latestFeedback: "",
      history: [],
      remoteEnabled: false,
      agentContext: null,
    };
    this.feedbackState.set(sessionId, created);
    this.log("debug", "feedback.state.created", { sessionId });
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
      this.log("error", "session.remote.persist_failed", { sessionId, error: String(err) });
    });
    this.events.onStateChange(sessionId);
    this.log("info", "session.remote.toggled", { sessionId, enabled });
  }

  isRemoteEnabled(sessionId: string): boolean {
    const state = this.feedbackState.get(sessionId);
    return state?.remoteEnabled ?? false;
  }

  setAgentContext(sessionId: string, context: string | null): void {
    const state = this.getFeedbackState(sessionId);
    state.agentContext = context;
  }

  getAgentContext(sessionId: string): string | null {
    return this.feedbackState.get(sessionId)?.agentContext ?? null;
  }

  hasQueuedFeedback(sessionId: string): boolean {
    const state = this.feedbackState.get(sessionId);
    return Boolean(state?.queuedFeedback);
  }

  setWaiter(sessionId: string, waiter: PendingWaiter): void {
    const state = this.getFeedbackState(sessionId);
    state.pendingWaiter = waiter;
    this.markActivity(sessionId, "feedback_request");
    this.persistFeedbackState(sessionId);
    this.events.onStateChange(sessionId);
  }

  async clearPendingWaiter(sessionId: string, reason: string, expectedRequestId?: string): Promise<void> {
    const state = this.feedbackState.get(sessionId);
    if (!state || !state.pendingWaiter) return;

    const waiter = state.pendingWaiter;
    if (expectedRequestId && waiter.requestId !== expectedRequestId) return;

    state.pendingWaiter = null;
    await this.persistFeedbackState(sessionId);
    this.events.onStateChange(sessionId);

    waiter.resolve({ type: "closed", reason });

    this.log("warn", "feedback.waiter.cleared", {
      sessionId,
      reason,
      requestId: waiter.requestId,
      waitId: waiter.waitId,
      waitStartedAt: waiter.startedAt,
      waitDurationMs: Date.now() - Date.parse(waiter.startedAt),
    });
  }

  async deliverFeedback(
    sessionId: string,
    content: string,
    images?: ImageAttachment[]
  ): Promise<{ delivered: boolean; queued: boolean }> {
    const state = this.getFeedbackState(sessionId);
    const queuedAt = new Date().toISOString();

    state.latestFeedback = content;
    this.log("debug", "feedback.received", {
      sessionId,
      contentLength: content.length,
      imageCount: images?.length ?? 0,
      hasPendingWaiter: Boolean(state.pendingWaiter),
    });

    // If there's an active waiter, deliver immediately
    if (state.pendingWaiter) {
      const waiter = state.pendingWaiter;
      state.pendingWaiter = null;
      state.queuedAt = null;
      state.queuedImages = null;
      await this.persistFeedbackState(sessionId);
      this.events.onStateChange(sessionId);

      waiter.resolve({ type: "feedback", content, images });
      this.markActivity(sessionId, "feedback_delivered");

      this.log("info", "feedback.delivered", {
        sessionId,
        waitId: waiter.waitId,
        contentLength: content.length,
        imageCount: images?.length ?? 0,
        waitDurationMs: Date.now() - Date.parse(waiter.startedAt),
      });

      return { delivered: true, queued: false };
    }

    // No waiter, queue the feedback
    state.queuedFeedback = content;
    state.queuedImages = images && images.length > 0 ? images : null;
    state.queuedAt = queuedAt;
    await this.persistFeedbackState(sessionId);
    this.events.onStateChange(sessionId);

    this.log("info", "feedback.queued", {
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

    this.persistFeedbackState(sessionId);
    this.markActivity(sessionId, "queued_feedback_consumed");
    this.events.onStateChange(sessionId);

    this.log("info", "feedback.queued.consumed", {
      sessionId,
      contentLength: content.length,
      imageCount: images?.length ?? 0,
    });

    return { content, images };
  }

  appendHistory(sessionId: string, content: string, images?: ImageAttachment[]): void {
    const state = this.getFeedbackState(sessionId);
    state.history.push({
      role: "user",
      content,
      images,
      createdAt: new Date().toISOString(),
    });

    // Trim to max history
    while (state.history.length > MAX_SESSION_HISTORY) {
      state.history.shift();
    }

    this.persistFeedbackState(sessionId);
  }

  // ==========================================================================
  // ALIAS MANAGEMENT
  // ==========================================================================

  getSessionAlias(sessionId: string): string {
    return (
      this.manualAliases.get(sessionId) ||
      this.inferredAliases.get(sessionId) ||
      this.sessions.get(sessionId)?.clientAlias ||
      sessionId
    );
  }

  setManualAlias(sessionId: string, alias: string): void {
    this.manualAliases.set(sessionId, alias);
    this.store.setManualAlias(sessionId, alias);
    this.events.onStateChange(sessionId);
  }

  setInferredAlias(sessionId: string, alias: string): void {
    this.inferredAliases.set(sessionId, alias);
  }

  getNextClientGeneration(alias: string): number {
    const current = this.clientGenerations.get(alias) ?? 0;
    const next = current + 1;
    this.clientGenerations.set(alias, next);
    this.store.setClientGeneration(alias, next);
    return next;
  }

  // ==========================================================================
  // UI SESSION
  // ==========================================================================

  getActiveUiSessionId(): string {
    return this.activeUiSessionId;
  }

  async setActiveUiSession(sessionId: string): Promise<void> {
    this.activeUiSessionId = sessionId;
    await this.store.setActiveUiSessionId(sessionId);
    this.events.onStateChange();
  }

  /**
   * Resolve which session to target for feedback.
   *
   * STRICT MODE: If requested session doesn't exist, returns null.
   * No fallback chain - the caller must handle the error.
   */
  resolveTargetSession(requestedSessionId?: string): string | null {
    // If a specific session was requested, validate it exists
    if (requestedSessionId && requestedSessionId.trim().length > 0) {
      if (this.sessions.has(requestedSessionId)) {
        return requestedSessionId;
      }
      // Requested session doesn't exist - don't fall back
      return null;
    }

    // No specific session requested - use active UI session if it exists
    if (this.sessions.has(this.activeUiSessionId)) {
      return this.activeUiSessionId;
    }

    // Active UI session doesn't exist - check if there's exactly one session
    if (this.sessions.size === 1) {
      return this.sessions.keys().next().value as string;
    }

    // Multiple sessions or none - can't auto-resolve
    return null;
  }

  // ==========================================================================
  // PRUNING
  // ==========================================================================

  getDisconnectAfterMinutes(): number {
    const configured = this.store.getSnapshot().settings?.disconnectAfterMinutes;
    if (!Number.isFinite(configured)) return DEFAULT_DISCONNECT_AFTER_MINUTES;
    return Math.max(MIN_DISCONNECT_AFTER_MINUTES, Math.min(MAX_DISCONNECT_AFTER_MINUTES, Math.floor(configured)));
  }

  async setDisconnectAfterMinutes(minutes: number): Promise<void> {
    const normalized = Math.max(
      MIN_DISCONNECT_AFTER_MINUTES,
      Math.min(MAX_DISCONNECT_AFTER_MINUTES, Math.floor(minutes))
    );
    await this.store.setDisconnectAfterMinutes(normalized);
    this.log("info", "settings.disconnect_after.updated", { minutes: normalized });
    this.events.onStateChange();
  }

  private startAutoPrune(): void {
    this.pruneIntervalId = setInterval(() => {
      this.pruneStale();
    }, AUTO_PRUNE_INTERVAL_MS);
  }

  /**
   * Prune stale sessions.
   *
   * Rules:
   * 1. Sessions with active pendingWaiter are NEVER pruned (protected)
   * 2. Sessions inactive longer than disconnectAfterMinutes are pruned
   */
  pruneStale(): number {
    const now = Date.now();
    const disconnectAfterMs = this.getDisconnectAfterMinutes() * 60 * 1000;
    let pruned = 0;

    for (const [sessionId, entry] of this.sessions.entries()) {
      const state = this.feedbackState.get(sessionId);

      // Protected: session is waiting for feedback
      if (state?.pendingWaiter) {
        continue;
      }

      // Protected: plugin sessions (no MCP transport) are stateless HTTP clients
      // that always reconnect. They don't have a transport lifecycle signal, so
      // auto-prune would incorrectly kill them during gaps between tool calls
      // (e.g., while the agent processes feedback before calling get_feedback again).
      // Plugin sessions are cleaned up via: session.deleted events, manual prune, or UI delete.
      if (!entry.transport) {
        continue;
      }

      const lastActivity = Date.parse(entry.lastActivityAt);
      if (isNaN(lastActivity)) continue;

      const inactiveMs = now - lastActivity;
      if (inactiveMs > disconnectAfterMs) {
        // Prune this session
        this.sessions.delete(sessionId);
        this.feedbackState.delete(sessionId);
        this.store.deleteSession(sessionId);
        pruned++;

        this.log("info", "session.auto-pruned", {
          sessionId,
          inactiveMs,
          disconnectAfterMinutes: this.getDisconnectAfterMinutes(),
        });
      }
    }

    // Also clean up orphaned persisted sessions
    const persistedSessions = this.store.getSnapshot().sessionMetadataById;
    for (const [sessionId, meta] of Object.entries(persistedSessions)) {
      if (this.sessions.has(sessionId)) continue; // still live

      const state = this.feedbackState.get(sessionId);
      if (state?.pendingWaiter) continue; // protected (shouldn't happen, but be safe)

      const lastActivity = meta?.lastActivityAt ? Date.parse(meta.lastActivityAt) : 0;
      if (lastActivity > 0 && (now - lastActivity) > disconnectAfterMs) {
        this.feedbackState.delete(sessionId);
        this.store.deleteSession(sessionId);
        pruned++;

        this.log("info", "session.auto-pruned.orphaned", {
          sessionId,
          inactiveMs: now - lastActivity,
        });
      }
    }

    // If the active UI session was pruned, reset to the next available session
    if (pruned > 0) {
      if (!this.sessions.has(this.activeUiSessionId)) {
        const nextSession = this.sessions.keys().next().value as string | undefined;
        this.activeUiSessionId = nextSession ?? "";
        this.store.setActiveUiSessionId(this.activeUiSessionId);
        this.log("info", "session.active-ui-reset-after-prune", {
          newActiveUiSessionId: this.activeUiSessionId || "(none)",
        });
      }
      this.events.onStateChange();
    }

    return pruned;
  }

  /**
   * Manual prune: prune sessions older than maxAgeMs.
   * Unlike auto-prune, this can optionally force-prune waiting sessions.
   */
  async manualPrune(maxAgeMs: number, forceIncludeWaiting = false): Promise<{ pruned: string[]; errors: string[] }> {
    const now = Date.now();
    const pruned: string[] = [];
    const errors: string[] = [];

    for (const [sessionId, entry] of this.sessions.entries()) {
      const lastActivity = Date.parse(entry.lastActivityAt);
      if (isNaN(lastActivity)) continue;

      const age = now - lastActivity;
      if (age < maxAgeMs) continue;

      // Skip waiting sessions unless forced
      const state = this.feedbackState.get(sessionId);
      if (state?.pendingWaiter && !forceIncludeWaiting) continue;

      try {
        await this.deleteSession(sessionId, "manual_prune");
        pruned.push(sessionId);
      } catch (err) {
        errors.push(sessionId);
        this.log("error", "session.manual-prune.error", { sessionId, error: String(err) });
      }
    }

    return { pruned, errors };
  }

  // ==========================================================================
  // PERSISTENCE HELPERS
  // ==========================================================================

  private async persistSessionMetadata(sessionId: string, entry: StreamableSessionEntry): Promise<void> {
    await this.store.saveSessionMetadata(sessionId, {
      sessionId,
      transportId: entry.transportId,
      clientAlias: entry.clientAlias,
      clientGeneration: entry.clientGeneration,
      createdAt: entry.createdAt,
      lastSeenAt: entry.lastActivityAt,
      lastActivityAt: entry.lastActivityAt,
      status: entry.status,
    });
  }

  private async persistFeedbackState(sessionId: string): Promise<void> {
    const state = this.feedbackState.get(sessionId);
    if (!state) return;

    const persisted: PersistedFeedbackState = {
      queuedFeedback: state.queuedFeedback,
      queuedImages: state.queuedImages,
      queuedAt: state.queuedAt,
      latestFeedback: state.latestFeedback,
      history: state.history,
      remoteEnabled: state.remoteEnabled,
    };

    await this.store.saveFeedbackState(sessionId, persisted);
  }

  // ==========================================================================
  // LOGGING HELPER
  // ==========================================================================

  private log(level: "debug" | "info" | "warn" | "error", event: string, details: Record<string, unknown> = {}): void {
    this.events.onLog(level, event, details);
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export { DEFAULT_SESSION_ID, DEFAULT_DISCONNECT_AFTER_MINUTES, MIN_DISCONNECT_AFTER_MINUTES, MAX_DISCONNECT_AFTER_MINUTES };
