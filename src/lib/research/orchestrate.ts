/**
 * Orchestrator (PRD §8 step 2). Drives multi-round research that expands a
 * prerequisite-graph frontier and maps every discovery to a `GraphEvent` the
 * caller streams + persists.
 *
 * Responsibilities:
 *  - By DEFAULT, expand the frontier purely from the Copilot SDK's own knowledge
 *    (`CopilotProvider.generate` via the extractor) — no external web search or
 *    API keys required. Web search (Tavily/arXiv, optionally agentic via
 *    `CopilotProvider.runAgent`) is an OPTIONAL enrichment, enabled only when a
 *    `search`/`provider`/`useAgent` dep is supplied.
 *  - Server-side CONCURRENCY LIMITER (a semaphore sized users × parallelAgents)
 *    so we never open more Foundry sessions than we can afford.
 *  - Foundry 429 BACK-OFF (exponential + jitter) around model calls.
 *  - Map discoveries to `GraphEvent`s and stream them FIRST, persist SECOND
 *    (AC-7): events fire as concepts are discovered, never batched at the end.
 *  - Stop on convergence OR the safety budget cap (AC-3) via ConvergenceTracker.
 *
 * Stream-first design: the orchestrator is persistence-agnostic. It emits
 * `GraphEvent`s through `onEvent`; the worker wires that to the DB + SSE bus.
 *
 * Injectable deps make the whole loop unit-testable offline without a model or
 * network (see the offline test).
 */

import { z } from "zod";
import { CopilotProvider } from "@/lib/ai/copilot";
import { wouldCreateCycle } from "@/lib/ontology/invariants";
import type {
  Concept,
  GraphEvent,
  GraphStatus,
  KnowledgeGraph,
  PrerequisiteEdge,
  WebSource,
} from "@/lib/ontology/types";
import { searchAll, type WebSearchProvider } from "./search";
import { extractConcepts, type ExtractionResult } from "./extract";
import {
  ConvergenceTracker,
  DEFAULT_BUDGET,
  type ResearchBudget,
} from "./convergence";

/* -------------------------------------------------------------------------- */
/* Concurrency limiter                                                        */
/* -------------------------------------------------------------------------- */

/** A minimal counting semaphore: bounds concurrent async work. */
export class Semaphore {
  private permits: number;
  private readonly queue: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = Math.max(1, permits);
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    this.permits += 1;
    const next = this.queue.shift();
    if (next) {
      this.permits -= 1;
      next();
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/**
 * Process-wide model-session limiter sized for `users × parallelAgents`. Sized
 * generously by default; override via RESEARCH_MAX_CONCURRENT_SESSIONS.
 */
const GLOBAL_MAX_SESSIONS = Number(
  process.env.RESEARCH_MAX_CONCURRENT_SESSIONS ?? 6,
);
const globalForLimiter = globalThis as unknown as {
  __kgResearchLimiter?: Semaphore;
};
export const sessionLimiter: Semaphore =
  globalForLimiter.__kgResearchLimiter ??
  (globalForLimiter.__kgResearchLimiter = new Semaphore(GLOBAL_MAX_SESSIONS));

/* -------------------------------------------------------------------------- */
/* Foundry 429 back-off                                                       */
/* -------------------------------------------------------------------------- */

function isRateLimit(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests") ||
    msg.includes("throttl")
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry `fn` with exponential back-off + jitter on Foundry 429 throttling. */
export async function withFoundryBackoff<T>(
  fn: () => Promise<T>,
  retries = 4,
  baseMs = 800,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimit(err) || attempt >= retries) throw err;
      const backoff = baseMs * 2 ** attempt + Math.random() * 250;
      console.warn(
        `[research/orchestrate] Foundry 429 — backing off ${Math.round(backoff)}ms (attempt ${attempt + 1}/${retries})`,
      );
      await sleep(backoff);
      attempt += 1;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Search tool (defineTool) + source gathering per query                      */
/* -------------------------------------------------------------------------- */

/** Zod schema for the `search` tool the research agent invokes autonomously. */
export const searchToolParameters = z.object({
  query: z.string().describe("A focused web/scholarly search query."),
  scholarly: z
    .boolean()
    .optional()
    .describe("Bias toward academic/arXiv sources."),
});

/**
 * Gather sources for one frontier query. Uses `CopilotProvider.runAgent` with
 * the `search` tool so the model can issue several searches autonomously; the
 * tool handler accumulates every `WebSource` it returns. Falls back to a direct
 * `searchAll` when the model/agent is unavailable (no key, 429s exhausted) so
 * research degrades gracefully instead of crashing.
 */
async function gatherSources(
  topic: string,
  query: string,
  deps: ResolvedDeps,
): Promise<WebSource[]> {
  const collected: WebSource[] = [];
  const push = (xs: WebSource[]) => {
    for (const s of xs) collected.push(s);
  };

  // Direct search is always our floor; the agent may add more.
  const useAgent = deps.useAgent && CopilotProvider.isFoundryConfigured();

  if (!useAgent) {
    push(await deps.search(query));
    return collected;
  }

  try {
    await sessionLimiter.run(() =>
      withFoundryBackoff(() =>
        CopilotProvider.runAgent(
          `Research prerequisites for the topic "${topic}". ` +
            `Focus on: "${query}". Use the search tool 1-3 times with focused ` +
            `queries to gather authoritative sources, then briefly stop.`,
          [
            {
              name: "search",
              description:
                "Search the web and scholarly sources; returns titled snippets.",
              parameters: searchToolParameters,
              handler: async (args: unknown) => {
                const a = args as { query?: string; scholarly?: boolean };
                const q = (a.query ?? query).trim();
                const found = await deps.search(q);
                push(found);
                return found.map((s) => ({ title: s.title, url: s.url, snippet: s.snippet }));
              },
            },
          ],
          { tier: "fast" },
        ),
      ),
    );
  } catch (err) {
    console.warn(
      "[research/orchestrate] agent search failed — falling back to direct search.",
      err,
    );
    if (collected.length === 0) push(await deps.search(query));
  }
  return collected;
}

/* -------------------------------------------------------------------------- */
/* Orchestration                                                              */
/* -------------------------------------------------------------------------- */

export type ResearchDeps = {
  /**
   * OPTIONAL web-search enrichment. By default research runs source-free via the
   * Copilot SDK alone; pass a `search`/`provider` (or `useAgent`) to opt back in.
   */
  search?: (query: string) => Promise<WebSource[]>;
  /** Extractor (default: extractConcepts via CopilotProvider fast tier). */
  extract?: (
    topic: string,
    sources: WebSource[],
    graph: KnowledgeGraph,
    focus?: string,
  ) => Promise<ExtractionResult>;
  /** Use the agentic search loop (default: false). Implies web search. */
  useAgent?: boolean;
  /** Optional explicit search provider (enables web-search enrichment). */
  provider?: WebSearchProvider;
};

type ResolvedDeps = {
  search: (query: string) => Promise<WebSource[]>;
  extract: (
    topic: string,
    sources: WebSource[],
    graph: KnowledgeGraph,
    focus?: string,
  ) => Promise<ExtractionResult>;
  useAgent: boolean;
  /** Whether ANY web search runs; false → pure Copilot-SDK knowledge mode. */
  searchEnabled: boolean;
};

export type RunResearchOptions = {
  topicId: string;
  topic: string;
  budget?: Partial<ResearchBudget>;
  /** Number of parallel frontier agents per round (default 3). */
  parallelAgents?: number;
  deps?: ResearchDeps;
  /** Stream-first sink: called for EVERY node/edge/status as it is discovered. */
  onEvent: (event: GraphEvent) => void | Promise<void>;
  /** Cooperative cancellation. */
  signal?: AbortSignal;
};

export type RunResearchResult = {
  graph: KnowledgeGraph;
  status: GraphStatus;
  conceptSources: Map<string, WebSource[]>;
};

function resolveDeps(deps: ResearchDeps | undefined): ResolvedDeps {
  // Web search is OFF by default — research runs purely on the Copilot SDK's own
  // knowledge. Providing a search fn, a provider, or useAgent opts back in.
  const searchEnabled = Boolean(deps?.search || deps?.provider || deps?.useAgent);
  return {
    search:
      deps?.search ??
      ((q: string) => searchAll(q, {}, deps?.provider)),
    extract:
      deps?.extract ??
      ((topic, sources, graph, focus) =>
        extractConcepts(topic, sources, graph, undefined, focus)),
    useAgent: deps?.useAgent ?? false,
    searchEnabled,
  };
}

/**
 * Run the full research loop for one topic. Emits GraphEvents as concepts/edges
 * are discovered (stream-first), stops on convergence or the safety budget cap,
 * and returns the final graph + terminal status + per-concept citing sources.
 */
export async function runResearch(
  opts: RunResearchOptions,
): Promise<RunResearchResult> {
  const deps = resolveDeps(opts.deps);
  const budget = { ...DEFAULT_BUDGET, ...opts.budget };
  const parallelAgents = Math.max(1, opts.parallelAgents ?? 3);
  const tracker = new ConvergenceTracker(budget);

  const graph: KnowledgeGraph = {
    topicId: opts.topicId,
    nodes: [],
    edges: [],
    status: "researching",
  };
  const conceptSources = new Map<string, WebSource[]>();

  const emit = async (event: GraphEvent) => {
    await opts.onEvent(event);
  };

  await emit({ type: "status", payload: "researching", ts: Date.now() });

  // Frontier of queries to expand. Seed with the topic itself.
  let frontier: string[] = [opts.topic];
  const searchedQueries = new Set<string>();

  let terminal: GraphStatus = "stopped";

  for (let round = 0; round < budget.maxRounds; round++) {
    if (opts.signal?.aborted) {
      terminal = "stopped";
      break;
    }
    // Take up to `parallelAgents` unsearched frontier queries this round.
    const batch = frontier
      .filter((q) => !searchedQueries.has(q.toLowerCase()))
      .slice(0, parallelAgents);
    if (batch.length === 0) {
      // Nothing left to expand → treat as converged.
      terminal = "converged";
      break;
    }
    for (const q of batch) searchedQueries.add(q.toLowerCase());

    // Copilot-SDK knowledge mode by default: expand the frontier directly from
    // the model's own knowledge. Web search runs only when explicitly enabled.
    const focus = batch.join(", ");
    let roundSources: WebSource[] = [];
    if (deps.searchEnabled) {
      const perAgent = await Promise.all(
        batch.map((q) =>
          sessionLimiter
            .run(() => gatherSources(opts.topic, q, deps))
            .catch((err) => {
              console.warn("[research/orchestrate] gatherSources failed", err);
              return [] as WebSource[];
            }),
        ),
      );
      roundSources = dedupeSources(perAgent.flat());
    }

    // Extract concepts/edges for this frontier focus against the live graph.
    let extraction: ExtractionResult;
    try {
      extraction = await withFoundryBackoff(() =>
        deps.extract(opts.topic, roundSources, graph, focus),
      );
    } catch (err) {
      console.warn("[research/orchestrate] extraction failed this round", err);
      extraction = {
        newConcepts: [],
        newEdges: [],
        conceptSources: new Map(),
        rejectedEdges: [],
      };
    }

    // Apply + STREAM nodes first, then edges (stream-first, persist-second).
    const newFrontier: string[] = [];
    for (const concept of extraction.newConcepts) {
      graph.nodes.push(concept);
      const srcs = extraction.conceptSources.get(concept.id);
      if (srcs && srcs.length) conceptSources.set(concept.id, srcs);
      newFrontier.push(concept.name);
      await emit({ type: "node", payload: concept, ts: Date.now() });
    }
    for (const edge of extraction.newEdges) {
      // Defensive re-check against the now-applied graph (keeps DAG, AC-6).
      if (wouldCreateCycle(graph, edge)) continue;
      if (graph.edges.some((e) => e.from === edge.from && e.to === edge.to)) {
        continue;
      }
      graph.edges.push(edge);
      await emit({ type: "edge", payload: edge, ts: Date.now() });
    }

    // Record the round and check convergence / budget.
    const decision = tracker.recordRound({
      newConcepts: extraction.newConcepts.length,
      sourcesUsed: roundSources.length,
    });
    if (decision.done) {
      terminal = decision.status;
      console.warn(
        `[research/orchestrate] stopping: ${decision.reason} (${JSON.stringify(tracker.usage())})`,
      );
      break;
    }

    // Expand the frontier with the newly discovered concept names.
    frontier = [...frontier, ...newFrontier];
    terminal = "converged"; // default if the loop exits via maxRounds boundary
  }

  graph.status = terminal;
  await emit({ type: "status", payload: terminal, ts: Date.now() });
  return { graph, status: terminal, conceptSources };
}

function dedupeSources(sources: WebSource[]): WebSource[] {
  const seen = new Set<string>();
  const out: WebSource[] = [];
  for (const s of sources) {
    const key = (s.url || s.title).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export type { Concept, PrerequisiteEdge, GraphEvent };
