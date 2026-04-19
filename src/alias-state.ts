import type { PersistedTaskSyncState } from "./session-state-store.js";

type AliasStateDependencies = {
  defaultSessionId: string;
  onStateChange(sessionId?: string): void;
  persistManualAlias(sessionId: string, alias: string | null): Promise<void>;
  persistInferredAlias(sessionId: string, alias: string | null): Promise<void>;
  persistClientGeneration(alias: string, generation: number): Promise<void>;
  persistActiveUiSessionId(sessionId: string): Promise<void>;
};

export class AliasStateManager {
  private manualAliases = new Map<string, string>();
  private inferredAliases = new Map<string, string>();
  private clientGenerations = new Map<string, number>();
  private activeUiSessionId: string;

  constructor(private deps: AliasStateDependencies) {
    this.activeUiSessionId = deps.defaultSessionId;
  }

  hydrate(snapshot: PersistedTaskSyncState): void {
    this.activeUiSessionId = snapshot.activeUiSessionId || this.deps.defaultSessionId;

    for (const [sessionId, alias] of Object.entries(snapshot.manualAliasBySession)) {
      this.manualAliases.set(sessionId, alias);
    }

    for (const [sessionId, alias] of Object.entries(snapshot.inferredAliasBySession)) {
      this.inferredAliases.set(sessionId, alias);
    }

    for (const [alias, generation] of Object.entries(snapshot.clientGenerationByAlias)) {
      this.clientGenerations.set(alias, generation);
    }
  }

  getSessionAlias(sessionId: string, clientAlias?: string): string {
    return (
      this.manualAliases.get(sessionId) ||
      this.inferredAliases.get(sessionId) ||
      clientAlias ||
      sessionId
    );
  }

  setManualAlias(sessionId: string, alias: string): void {
    this.manualAliases.set(sessionId, alias);
    this.deps.persistManualAlias(sessionId, alias);
    this.deps.onStateChange(sessionId);
  }

  setInferredAlias(sessionId: string, alias: string): void {
    this.inferredAliases.set(sessionId, alias);
    this.deps.persistInferredAlias(sessionId, alias);
    this.deps.onStateChange(sessionId);
  }

  getNextClientGeneration(alias: string): number {
    const current = this.clientGenerations.get(alias) ?? 0;
    const next = current + 1;
    this.clientGenerations.set(alias, next);
    this.deps.persistClientGeneration(alias, next);
    return next;
  }

  getActiveUiSessionId(): string {
    return this.activeUiSessionId;
  }

  async setActiveUiSession(sessionId: string): Promise<void> {
    this.activeUiSessionId = sessionId;
    await this.deps.persistActiveUiSessionId(sessionId);
    this.deps.onStateChange();
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.manualAliases.delete(sessionId);
    this.inferredAliases.delete(sessionId);

    if (this.activeUiSessionId === sessionId) {
      this.activeUiSessionId = this.deps.defaultSessionId;
      await this.deps.persistActiveUiSessionId(this.deps.defaultSessionId);
    }
  }

  resolveTargetSession(sessions: ReadonlyMap<string, unknown>, requestedSessionId?: string): string | null {
    if (requestedSessionId && requestedSessionId.trim().length > 0) {
      if (sessions.has(requestedSessionId)) {
        return requestedSessionId;
      }
      return null;
    }

    if (sessions.has(this.activeUiSessionId)) {
      return this.activeUiSessionId;
    }

    if (sessions.size === 1) {
      return sessions.keys().next().value as string;
    }

    return null;
  }
}
