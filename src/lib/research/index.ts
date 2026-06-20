/**
 * Research engine — public API (PRD §8 step 2; AC-1/2/3/6/7).
 *
 * Topic/prompt → a live, streaming prerequisite knowledge graph:
 *   - search.ts       web + scholarly source retrieval (Tavily + arXiv)
 *   - extract.ts      concepts + DAG-safe prerequisite edges via Copilot (fast tier)
 *   - convergence.ts  growth-threshold stop + safety budget cap
 *   - orchestrate.ts  parallel frontier agents, concurrency limiter, 429 back-off
 *   - worker.ts       background loop (decoupled from the HTTP request)
 *   - bus.ts          live SSE tail · persist.ts  durable replay
 *
 * The routes live at:
 *   POST /api/research          → start a session, returns { sessionId }
 *   GET  /api/research/stream    → EventSource (GET-only) SSE of GraphEvents
 */

import { runResearch, type RunResearchOptions } from "./orchestrate";
import { DEFAULT_BUDGET, type ResearchBudget } from "./convergence";
import type { GraphEvent, KnowledgeGraph, WebSource } from "@/lib/ontology/types";

export { runResearch } from "./orchestrate";
export {
  ConvergenceTracker,
  DEFAULT_BUDGET,
  type ResearchBudget,
} from "./convergence";
export { extractConcepts, type ExtractionResult } from "./extract";
export {
  searchAll,
  searchArxiv,
  TavilySearchProvider,
  defaultSearchProvider,
  type WebSearchProvider,
} from "./search";
export {
  startResearchWorker,
  isResearchRunning,
  cancelResearch,
} from "./worker";
export { subscribe, publish, isDone, cleanup } from "./bus";
export { loadGraph, replayEvents } from "./persist";

/**
 * Convenience generator: run research and yield each `GraphEvent` as it is
 * produced, resolving to the final graph. Useful for tests/CLI; the HTTP path
 * uses the background worker + SSE instead.
 */
export async function* researchTopic(
  topic: string,
  budget: Partial<ResearchBudget> = DEFAULT_BUDGET,
  opts: Omit<RunResearchOptions, "topic" | "onEvent" | "budget" | "topicId"> & {
    topicId?: string;
  } = {},
): AsyncGenerator<GraphEvent, KnowledgeGraph, void> {
  const queue: GraphEvent[] = [];
  let notify: (() => void) | null = null;
  const onEvent = (event: GraphEvent) => {
    queue.push(event);
    notify?.();
  };

  const done = runResearch({
    topicId: opts.topicId ?? `topic-${Date.now()}`,
    topic,
    budget,
    parallelAgents: opts.parallelAgents,
    deps: opts.deps,
    onEvent,
    signal: opts.signal,
  });

  let finished = false;
  const result = done.then((r) => {
    finished = true;
    notify?.();
    return r;
  });

  while (!finished || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
      notify = null;
      continue;
    }
    yield queue.shift()!;
  }
  return (await result).graph;
}

export type { WebSource };
