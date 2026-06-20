/**
 * Pure SSE event → graph state reducer for the live knowledge-graph view
 * (PRD §8 step 4; AC-7/8; AC-6 display guard).
 *
 * The research-engine streams `GraphEvent`s over SSE (`data: <GraphEvent JSON>`).
 * This reducer folds those events into a small, immutable client-side state that
 * the Cytoscape view renders. It is intentionally:
 *   - PURE and dependency-light (no React, no DOM) so it can be unit-tested
 *     offline and reused by the `useGraphStream` hook.
 *   - IDEMPOTENT: nodes are upserted by `id` and edges deduped by `from|to`, so a
 *     reconnecting EventSource (which REPLAYS the persisted graph before tailing
 *     live events) reconciles automatically without duplicates.
 *   - DAG-SAFE on display: an incoming edge that would close a cycle is rejected
 *     and surfaced via `error`, never rendered (AC-6). We trust the engine's DAG
 *     guarantee but defend the view anyway.
 */

import { wouldCreateCycle } from "@/lib/ontology/invariants";
import type {
  Concept,
  GraphEvent,
  GraphStatus,
  KnowledgeGraph,
  PrerequisiteEdge,
} from "@/lib/ontology/types";

/** Local, render-ready projection of the streamed graph. */
export type GraphStreamState = {
  nodes: Concept[];
  edges: PrerequisiteEdge[];
  status: GraphStatus;
  /** Last DAG-violation message (display guard); null when healthy. */
  error: string | null;
  /** Count of events folded in — handy for "is anything happening" affordances. */
  eventCount: number;
};

export const initialGraphStreamState: GraphStreamState = {
  nodes: [],
  edges: [],
  status: "idle",
  error: null,
  eventCount: 0,
};

const edgeKey = (e: PrerequisiteEdge) => `${e.from}\u0000${e.to}`;

/** Adapt the flat state into the `KnowledgeGraph` shape the guards expect. */
function asGraph(state: GraphStreamState): KnowledgeGraph {
  return {
    topicId: "",
    nodes: state.nodes,
    edges: state.edges,
    status: state.status,
  };
}

/**
 * Fold a single `GraphEvent` into state, returning a NEW state object when
 * something changed (and the same reference when the event was a no-op, so
 * React can skip re-renders).
 */
export function reduceGraphEvent(
  state: GraphStreamState,
  event: GraphEvent,
): GraphStreamState {
  switch (event.type) {
    case "node": {
      const incoming = event.payload;
      const idx = state.nodes.findIndex((n) => n.id === incoming.id);
      let nodes: Concept[];
      if (idx === -1) {
        nodes = [...state.nodes, incoming];
      } else {
        // Upsert: replace in place only if the payload actually differs.
        const prev = state.nodes[idx];
        if (
          prev.name === incoming.name &&
          prev.definition === incoming.definition &&
          prev.summary === incoming.summary &&
          prev.known === incoming.known
        ) {
          return state;
        }
        nodes = state.nodes.slice();
        nodes[idx] = incoming;
      }
      return { ...state, nodes, eventCount: state.eventCount + 1 };
    }

    case "edge": {
      const incoming = event.payload;
      const key = edgeKey(incoming);
      if (state.edges.some((e) => edgeKey(e) === key)) {
        return state; // duplicate (e.g. replay) — ignore.
      }
      // Display-side DAG guard (AC-6): never render a cycle.
      if (wouldCreateCycle(asGraph(state), incoming)) {
        return {
          ...state,
          error: `Rejected edge ${incoming.from} → ${incoming.to}: would create a cycle (DAG invariant).`,
          eventCount: state.eventCount + 1,
        };
      }
      return {
        ...state,
        edges: [...state.edges, incoming],
        error: null,
        eventCount: state.eventCount + 1,
      };
    }

    case "status": {
      if (state.status === event.payload) {
        return { ...state, eventCount: state.eventCount + 1 };
      }
      return {
        ...state,
        status: event.payload,
        eventCount: state.eventCount + 1,
      };
    }

    default:
      return state;
  }
}

/** True once the research run has reached a terminal status. */
export function isTerminalStatus(status: GraphStatus): boolean {
  return status === "converged" || status === "stopped";
}

/** Seed state from an already-loaded graph (static/offline render path). */
export function stateFromGraph(graph: KnowledgeGraph): GraphStreamState {
  return {
    nodes: graph.nodes,
    edges: graph.edges,
    status: graph.status,
    error: null,
    eventCount: graph.nodes.length + graph.edges.length,
  };
}
