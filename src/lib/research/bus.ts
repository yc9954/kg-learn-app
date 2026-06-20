/**
 * In-memory pub/sub event bus for live `GraphEvent`s (AC-7), keyed by session
 * (= topic) id. The SSE endpoint subscribes; the background worker publishes.
 *
 * This is the LIVE tail. Durable replay comes from the DB (persist.ts) so a
 * late or reconnecting subscriber still sees the full graph: SSE replays from
 * the DB first, then tails this bus. The bus also keeps a small ring buffer so
 * a subscriber that attaches mid-round does not miss the very latest events
 * between its DB snapshot and its live subscription.
 *
 * Process-local by design. In a horizontally-scaled deployment this would be a
 * Redis/Service Bus fan-out; the subscribe/publish contract stays identical.
 */

import type { GraphEvent } from "@/lib/ontology/types";

type Listener = (event: GraphEvent) => void;

const BUFFER_LIMIT = 512;

class SessionChannel {
  readonly listeners = new Set<Listener>();
  readonly buffer: GraphEvent[] = [];
  done = false;

  publish(event: GraphEvent) {
    this.buffer.push(event);
    if (this.buffer.length > BUFFER_LIMIT) this.buffer.shift();
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        /* a slow/broken listener must not break the worker */
      }
    }
    if (event.type === "status" && event.payload !== "researching") {
      this.done = true;
    }
  }
}

const globalForBus = globalThis as unknown as {
  __kgResearchBus?: Map<string, SessionChannel>;
};
const channels: Map<string, SessionChannel> =
  globalForBus.__kgResearchBus ?? (globalForBus.__kgResearchBus = new Map());

function channel(sessionId: string): SessionChannel {
  let ch = channels.get(sessionId);
  if (!ch) {
    ch = new SessionChannel();
    channels.set(sessionId, ch);
  }
  return ch;
}

/** Publish a live GraphEvent to a session's subscribers. */
export function publish(sessionId: string, event: GraphEvent): void {
  channel(sessionId).publish(event);
}

/** True once a terminal status event has been published for the session. */
export function isDone(sessionId: string): boolean {
  return channels.get(sessionId)?.done ?? false;
}

/**
 * Subscribe to a session's live events. Returns an unsubscribe function.
 * Pass `sinceTs` to also replay buffered events newer than that timestamp
 * (closes the gap between a DB snapshot and the live tail).
 */
export function subscribe(
  sessionId: string,
  listener: Listener,
  sinceTs?: number,
): () => void {
  const ch = channel(sessionId);
  if (sinceTs !== undefined) {
    for (const e of ch.buffer) {
      if (e.ts > sinceTs) {
        try {
          listener(e);
        } catch {
          /* ignore */
        }
      }
    }
  }
  ch.listeners.add(listener);
  return () => ch.listeners.delete(listener);
}

/** Drop a session channel once it is finished and has no subscribers. */
export function cleanup(sessionId: string): void {
  const ch = channels.get(sessionId);
  if (ch && ch.done && ch.listeners.size === 0) channels.delete(sessionId);
}
