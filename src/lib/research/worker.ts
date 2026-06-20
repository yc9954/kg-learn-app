/**
 * Background research worker (PRD §4.5, AC-3/7). Runs the multi-round research
 * loop OUTSIDE the HTTP request lifecycle so it can exceed Azure App Service's
 * hard ~240s request timeout. `POST /api/research` fire-and-forgets this and
 * returns a sessionId immediately; the loop streams `GraphEvent`s to the bus
 * (live tail) and persists them to the DB (durable replay) as they arrive.
 *
 * In a scaled deployment this body belongs in a dedicated worker (WebJob /
 * Container Apps job / queue consumer). The contract — start by id, stream to
 * bus, persist to DB — is identical; only the process boundary moves.
 *
 * Stream-first, persist-second: we publish to the bus BEFORE awaiting the DB
 * write so the live graph never waits on storage (AC-7).
 */

import "server-only";
import type { GraphEvent } from "@/lib/ontology/types";
import { runResearch, type RunResearchOptions } from "./orchestrate";
import { publish, isDone, cleanup } from "./bus";
import { persistEvent, persistStatus } from "./persist";
import type { ResearchBudget } from "./convergence";

const globalForWorker = globalThis as unknown as {
  __kgResearchRunning?: Map<string, AbortController>;
};
const running: Map<string, AbortController> =
  globalForWorker.__kgResearchRunning ??
  (globalForWorker.__kgResearchRunning = new Map());

export type StartResearchArgs = {
  topicId: string;
  topic: string;
  budget?: Partial<ResearchBudget>;
  parallelAgents?: number;
  deps?: RunResearchOptions["deps"];
};

/** True if a research worker is already running for this session/topic. */
export function isResearchRunning(topicId: string): boolean {
  return running.has(topicId);
}

/**
 * Start (fire-and-forget) the background research loop for a topic. Idempotent:
 * if a run is already in flight for this topicId it is a no-op. Returns
 * immediately — never await this inside an HTTP handler.
 */
export function startResearchWorker(args: StartResearchArgs): void {
  if (running.has(args.topicId)) return;
  const controller = new AbortController();
  running.set(args.topicId, controller);

  const onEvent = async (event: GraphEvent) => {
    // Stream FIRST (live tail), then persist (durable replay).
    publish(args.topicId, event);
    try {
      await persistEvent(args.topicId, event);
    } catch (err) {
      console.warn("[research/worker] persist failed", err);
    }
  };

  // Detach: do NOT await. The HTTP handler returns before this resolves.
  void (async () => {
    try {
      await runResearch({
        topicId: args.topicId,
        topic: args.topic,
        budget: args.budget,
        parallelAgents: args.parallelAgents,
        deps: args.deps,
        onEvent,
        signal: controller.signal,
      });
    } catch (err) {
      console.error("[research/worker] research loop crashed", err);
      const status = "stopped" as const;
      const ev: GraphEvent = { type: "status", payload: status, ts: Date.now() };
      // Ensure subscribers/DB see a terminal status even on crash.
      if (!isDone(args.topicId)) {
        publish(args.topicId, ev);
        try {
          await persistStatus(args.topicId, status);
        } catch {
          /* best effort */
        }
      }
    } finally {
      running.delete(args.topicId);
      cleanup(args.topicId);
    }
  })();
}

/** Request cooperative cancellation of a running research session. */
export function cancelResearch(topicId: string): boolean {
  const controller = running.get(topicId);
  if (!controller) return false;
  controller.abort();
  return true;
}
