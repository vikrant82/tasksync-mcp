type JsonRpcPrimitive = string | number | boolean | null;
type JsonRpcValue = JsonRpcPrimitive | JsonRpcObject | JsonRpcValue[];
type JsonRpcObject = {
  [key: string]: JsonRpcValue;
};

export type ReplayableJsonRpcMessage = JsonRpcObject;

type ReplayTarget = {
  send: (eventId: string, message: ReplayableJsonRpcMessage) => Promise<void>;
};

type EventRecord = {
  eventId: string;
  streamId: string;
  message: ReplayableJsonRpcMessage;
  createdAt: string;
};

type EventStoreChangeHandler = () => Promise<void> | void;

export interface StreamEventStore {
  storeEvent(streamId: string, message: ReplayableJsonRpcMessage): Promise<string>;
  replayEventsAfter(lastEventId: string, replayTarget: ReplayTarget): Promise<string>;
  getStreamIdForEventId?(lastEventId: string): Promise<string | undefined>;
  deleteStream?(streamId: string): Promise<void>;
  serialize?(): Promise<SerializedStreamEventStore>;
}

export type SerializedStreamEventStore = {
  events: EventRecord[];
};

function cloneMessage(message: ReplayableJsonRpcMessage): ReplayableJsonRpcMessage {
  return JSON.parse(JSON.stringify(message)) as ReplayableJsonRpcMessage;
}

function compareEventIds(left: string, right: string): number {
  return left.localeCompare(right);
}

export class InMemoryStreamEventStore implements StreamEventStore {
  private readonly events = new Map<string, EventRecord>();
  private readonly onChange?: EventStoreChangeHandler;

  constructor(initialState?: SerializedStreamEventStore, onChange?: EventStoreChangeHandler) {
    this.onChange = onChange;
    for (const event of initialState?.events ?? []) {
      this.events.set(event.eventId, {
        ...event,
        message: cloneMessage(event.message),
      });
    }
  }

  async storeEvent(streamId: string, message: ReplayableJsonRpcMessage): Promise<string> {
    const eventId = `${streamId}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    this.events.set(eventId, {
      eventId,
      streamId,
      message: cloneMessage(message),
      createdAt: new Date().toISOString(),
    });
    await this.onChange?.();
    return eventId;
  }

  async replayEventsAfter(lastEventId: string, replayTarget: ReplayTarget): Promise<string> {
    const lastSeenEvent = this.events.get(lastEventId);
    if (!lastSeenEvent) {
      throw new Error(`Cannot replay after unknown event ID: ${lastEventId}`);
    }

    const targetStreamId = lastSeenEvent.streamId;
    const records = Array.from(this.events.values())
      .filter((event) => event.streamId === targetStreamId && compareEventIds(event.eventId, lastEventId) > 0)
      .sort((left, right) => compareEventIds(left.eventId, right.eventId));

    for (const record of records) {
      await replayTarget.send(record.eventId, cloneMessage(record.message));
    }

    return targetStreamId;
  }

  async getStreamIdForEventId(lastEventId: string): Promise<string | undefined> {
    return this.events.get(lastEventId)?.streamId;
  }

  async deleteStream(streamId: string): Promise<void> {
    let didDelete = false;
    for (const [eventId, event] of this.events.entries()) {
      if (event.streamId === streamId) {
        this.events.delete(eventId);
        didDelete = true;
      }
    }
    if (didDelete) {
      await this.onChange?.();
    }
  }

  async serialize(): Promise<SerializedStreamEventStore> {
    return {
      events: Array.from(this.events.values())
        .sort((left, right) => compareEventIds(left.eventId, right.eventId))
        .map((event) => ({
          ...event,
          message: cloneMessage(event.message),
        })),
    };
  }
}
