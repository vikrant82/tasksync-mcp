/**
 * Session Manager - Centralized session lifecycle and state management.
 *
 * This module is the single source of truth for session state.
 * All session-related operations should go through these APIs.
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AliasStateManager } from "./alias-state.js";
import {
  FeedbackStateManager,
  type FeedbackChannelState,
  type PendingFeedbackResult,
  type PendingWaiter,
} from "./feedback-state.js";
import { SessionStateStore, type ImageAttachment } from "./session-state-store.js";

export type {
  FeedbackChannelState,
  PendingFeedbackResult,
  PendingWaiter,
} from "./feedback-state.js";

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_SESSION_ID = "__default__";
const DEFAULT_DISCONNECT_AFTER_MINUTES = 0; // "Never" — auto-prune disabled by default
const MIN_DISCONNECT_AFTER_MINUTES = 1;
const MAX_DISCONNECT_AFTER_MINUTES = 24 * 60; // 1 day
const DISCONNECTED_SESSION_PRUNE_MINUTES = 5; // Disconnected sessions prune faster
const AUTO_PRUNE_INTERVAL_MS = 60 * 1000; // Check every minute

// ============================================================================
// TYPES
// ============================================================================

export type StreamableSessionEntry = {
  transport?: StreamableHTTPServerTransport;
  server?: Server;
  transportId: string;
  clientAlias: string;
  clientGeneration: number | null;
  createdAt: string;
  lastActivityAt: string;
  disconnectedAt: string | null;
  status: "active" | "disconnected" | "closed";
};

export type SessionInfo = {
  sessionId: string;
  alias: string;
  createdAt: string;
  lastActivityAt: string;
  status: "active" | "disconnected" | "closed";
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
  private aliasState: AliasStateManager;
  private feedbackState: FeedbackStateManager;
  private pruneIntervalId: NodeJS.Timeout | null = null;
  private pruning = false;

  constructor(
    private store: SessionStateStore,
    private events: SessionManagerEvents
  ) {
    this.aliasState = new AliasStateManager({
      defaultSessionId: DEFAULT_SESSION_ID,
      onStateChange: (sessionId) => this.events.onStateChange(sessionId),
      persistManualAlias: (sessionId, alias) => this.store.setManualAlias(sessionId, alias),
      persistInferredAlias: (sessionId, alias) => this.store.setInferredAlias(sessionId, alias),
      persistClientGeneration: (alias, generation) => this.store.setClientGeneration(alias, generation),
      persistActiveUiSessionId: (sessionId) => this.store.setActiveUiSessionId(sessionId),
    });
    this.feedbackState = new FeedbackStateManager({
      onStateChange: (sessionId) => this.events.onStateChange(sessionId),
      markActivity: (sessionId, reason) => this.markActivity(sessionId, reason),
      markDisconnected: (sessionId, reason) => this.markDisconnected(sessionId, reason),
      log: (level, event, details) => this.log(level, event, details),
      persistFeedbackState: (sessionId, state) => this.store.saveFeedbackState(sessionId, state),
    });
  }

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

    this.aliasState.hydrate(snapshot);

    // Restore feedback state (but NOT session entries - those require live transport)
    this.feedbackState.hydrate(snapshot.feedbackBySession);

    this.log("info", "session-manager.hydrated", {
      sessionCount: Object.keys(snapshot.sessionMetadataById).length,
      feedbackStateCount: this.feedbackState.size(),
      activeUiSessionId: this.aliasState.getActiveUiSessionId(),
      remoteEnabledSessions: this.feedbackState.getRemoteEnabledSessions(),
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
      disconnectedAt: null,
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
      const state = this.feedbackState.getExistingState(sessionId);
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
    await this.aliasState.deleteSession(sessionId);

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

  /**
   * Marks a session as disconnected. Called when we detect a genuine
   * transport/connection closure (as opposed to normal response lifecycle).
   */
  markDisconnected(sessionId: string, reason: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry || entry.status === "closed") return;

    const now = new Date().toISOString();
    entry.status = "disconnected";
    entry.disconnectedAt = now;

    this.log("warn", "session.disconnected", { sessionId, reason });
    this.persistSessionMetadata(sessionId, entry);
    this.events.onStateChange(sessionId);
  }

  /**
   * Marks a previously-disconnected session as active again.
   * Called when a new MCP request arrives on a disconnected session.
   */
  markReconnected(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry || entry.status !== "disconnected") return;

    entry.status = "active";
    entry.disconnectedAt = null;
    entry.lastActivityAt = new Date().toISOString();

    this.log("info", "session.reconnected", { sessionId });
    this.persistSessionMetadata(sessionId, entry);
    this.events.onStateChange(sessionId);
  }

  // ==========================================================================
  // FEEDBACK STATE
  // ==========================================================================

  getFeedbackState(sessionId: string): FeedbackChannelState {
    return this.feedbackState.getFeedbackState(sessionId);
  }

  isWaiting(sessionId: string): boolean {
    return this.feedbackState.isWaiting(sessionId);
  }

  setRemoteEnabled(sessionId: string, enabled: boolean): void {
    this.feedbackState.setRemoteEnabled(sessionId, enabled);
  }

  isRemoteEnabled(sessionId: string): boolean {
    return this.feedbackState.isRemoteEnabled(sessionId);
  }

  setAgentContext(sessionId: string, context: string | null, source: "assistant" | "fyi" = "assistant"): void {
    this.feedbackState.setAgentContext(sessionId, context, source);
  }

  getAgentContext(sessionId: string): string | null {
    return this.feedbackState.getAgentContext(sessionId);
  }

  getAgentContextSource(sessionId: string): "assistant" | "fyi" | null {
    return this.feedbackState.getAgentContextSource(sessionId);
  }

  hasQueuedFeedback(sessionId: string): boolean {
    return this.feedbackState.hasQueuedFeedback(sessionId);
  }

  setWaiter(sessionId: string, waiter: PendingWaiter): void {
    this.feedbackState.setWaiter(sessionId, waiter);
  }

  async clearPendingWaiter(sessionId: string, reason: string, expectedRequestId?: string): Promise<void> {
    await this.feedbackState.clearPendingWaiter(sessionId, reason, expectedRequestId);
  }

  async deliverFeedback(
    sessionId: string,
    content: string,
    images?: ImageAttachment[]
  ): Promise<{ delivered: boolean; queued: boolean }> {
    return this.feedbackState.deliverFeedback(sessionId, content, images);
  }

  consumeQueuedFeedback(sessionId: string): { content: string; images?: ImageAttachment[] } | null {
    return this.feedbackState.consumeQueuedFeedback(sessionId);
  }

  clearQueuedFeedback(sessionId: string): boolean {
    return this.feedbackState.clearQueuedFeedback(sessionId);
  }

  async queueUrgentFeedback(
    sessionId: string,
    content: string,
    images?: ImageAttachment[]
  ): Promise<{ delivered: boolean; queued: boolean }> {
    return this.feedbackState.queueUrgentFeedback(sessionId, content, images);
  }

  consumeUrgentFeedback(sessionId: string): { content: string; images?: ImageAttachment[] } | null {
    return this.feedbackState.consumeUrgentFeedback(sessionId);
  }

  hasUrgentFeedback(sessionId: string): boolean {
    return this.feedbackState.hasUrgentFeedback(sessionId);
  }

  clearUrgentFeedback(sessionId: string): boolean {
    return this.feedbackState.clearUrgentFeedback(sessionId);
  }

  appendHistory(sessionId: string, content: string, images?: ImageAttachment[]): void {
    this.feedbackState.appendHistory(sessionId, content, images);
  }

  // ==========================================================================
  // ALIAS MANAGEMENT
  // ==========================================================================

  getSessionAlias(sessionId: string): string {
    return this.aliasState.getSessionAlias(sessionId, this.sessions.get(sessionId)?.clientAlias);
  }

  setManualAlias(sessionId: string, alias: string): void {
    this.aliasState.setManualAlias(sessionId, alias);
  }

  setInferredAlias(sessionId: string, alias: string): void {
    this.aliasState.setInferredAlias(sessionId, alias);
  }

  getNextClientGeneration(alias: string): number {
    return this.aliasState.getNextClientGeneration(alias);
  }

  // ==========================================================================
  // UI SESSION
  // ==========================================================================

  getActiveUiSessionId(): string {
    return this.aliasState.getActiveUiSessionId();
  }

  async setActiveUiSession(sessionId: string): Promise<void> {
    await this.aliasState.setActiveUiSession(sessionId);
  }

  /**
   * Resolve which session to target for feedback.
   *
   * STRICT MODE: If requested session doesn't exist, returns null.
   * No fallback chain - the caller must handle the error.
   */
  resolveTargetSession(requestedSessionId?: string): string | null {
    return this.aliasState.resolveTargetSession(this.sessions, requestedSessionId);
  }

  // ==========================================================================
  // PRUNING
  // ==========================================================================

  getDisconnectAfterMinutes(): number {
    const configured = this.store.getSnapshot().settings?.disconnectAfterMinutes;
    if (configured === 0) return 0; // "Never" — auto-prune disabled
    if (!Number.isFinite(configured)) return DEFAULT_DISCONNECT_AFTER_MINUTES;
    return Math.max(MIN_DISCONNECT_AFTER_MINUTES, Math.min(MAX_DISCONNECT_AFTER_MINUTES, Math.floor(configured)));
  }

  async setDisconnectAfterMinutes(minutes: number): Promise<void> {
    let normalized: number;
    if (minutes === 0) {
      normalized = 0; // "Never" — auto-prune disabled
    } else {
      normalized = Math.max(
        MIN_DISCONNECT_AFTER_MINUTES,
        Math.min(MAX_DISCONNECT_AFTER_MINUTES, Math.floor(minutes))
      );
    }
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
   * 2. Disconnected sessions are pruned after DISCONNECTED_SESSION_PRUNE_MINUTES
   * 3. Active sessions inactive longer than disconnectAfterMinutes are pruned
   */
  async pruneStale(): Promise<number> {
    // Guard against overlapping async runs
    if (this.pruning) return 0;

    const disconnectMinutes = this.getDisconnectAfterMinutes();
    // Even with auto-prune disabled (0), we still prune disconnected sessions
    const hasActiveTimeout = disconnectMinutes > 0;
    const disconnectedTimeoutMs = DISCONNECTED_SESSION_PRUNE_MINUTES * 60 * 1000;

    if (!hasActiveTimeout) {
      // If auto-prune is disabled, only check disconnected sessions
    }

    this.pruning = true;
    try {
      const now = Date.now();
      const disconnectAfterMs = disconnectMinutes * 60 * 1000;
      let pruned = 0;

      // Collect candidates from live sessions
      const candidates: string[] = [];
      for (const [sessionId, entry] of this.sessions.entries()) {
        const state = this.feedbackState.getExistingState(sessionId);
        if (state?.pendingWaiter) continue; // Protected: actively waiting for feedback

        const isDisconnected = entry.status === "disconnected";

        if (isDisconnected && entry.disconnectedAt) {
          // Disconnected sessions use a shorter timeout measured from disconnectedAt
          const disconnectedTime = Date.parse(entry.disconnectedAt);
          if (!isNaN(disconnectedTime) && now - disconnectedTime > disconnectedTimeoutMs) {
            candidates.push(sessionId);
          }
        } else if (hasActiveTimeout) {
          // Active sessions use the configured inactivity timeout
          const lastActivity = Date.parse(entry.lastActivityAt);
          if (isNaN(lastActivity)) continue;
          if (now - lastActivity > disconnectAfterMs) {
            candidates.push(sessionId);
          }
        }
      }

      // Prune live sessions via deleteSession (closes transport, clears aliases, etc.)
      for (const sessionId of candidates) {
        try {
          await this.deleteSession(sessionId, "auto_prune");
          pruned++;
          this.log("info", "session.auto-pruned", {
            sessionId,
            disconnectAfterMinutes: disconnectMinutes,
          });
        } catch (err) {
          this.log("error", "session.auto-prune.error", { sessionId, error: String(err) });
        }
      }

      // Clean up orphaned persisted sessions (not in live sessions map)
      const persistedSessions = this.store.getSnapshot().sessionMetadataById;
      for (const [sessionId, meta] of Object.entries(persistedSessions)) {
        if (this.sessions.has(sessionId)) continue; // still live (or already pruned above)

        const state = this.feedbackState.getExistingState(sessionId);
        if (state?.pendingWaiter) continue;

        const isDisconnected = meta?.status === "disconnected";
        const lastActivity = meta?.lastActivityAt ? Date.parse(meta.lastActivityAt) : 0;
        const disconnectedTime = meta?.disconnectedAt ? Date.parse(meta.disconnectedAt) : 0;

        let shouldPrune = false;
        if (isDisconnected && disconnectedTime > 0) {
          shouldPrune = (now - disconnectedTime) > disconnectedTimeoutMs;
        } else if (hasActiveTimeout && lastActivity > 0) {
          shouldPrune = (now - lastActivity) > disconnectAfterMs;
        }

        if (shouldPrune) {
          this.feedbackState.delete(sessionId);
          await this.store.deleteSession(sessionId);
          pruned++;

          this.log("info", "session.auto-pruned.orphaned", {
            sessionId,
            inactiveMs: lastActivity > 0 ? now - lastActivity : undefined,
          });
        }
      }

      return pruned;
    } finally {
      this.pruning = false;
    }
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
      const state = this.feedbackState.getExistingState(sessionId);
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
      disconnectedAt: entry.disconnectedAt,
      status: entry.status,
    });
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
