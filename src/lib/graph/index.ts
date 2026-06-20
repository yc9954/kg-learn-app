/**
 * Graph domain helpers (server-side mutation + persistence glue).
 * The structural invariants live in `@/lib/ontology/invariants`; re-exported
 * here for ergonomic imports. TODO(research-engine/kg-graph-viz): add graph
 * assembly, dedup, and Prisma persistence helpers as needed.
 */
import { wouldCreateCycle, topoSort } from "@/lib/ontology/invariants";
import type {
  KnowledgeGraph,
  PrerequisiteEdge,
} from "@/lib/ontology/types";

export { wouldCreateCycle, topoSort };

/** Safely add an edge, rejecting anything that would break the DAG (AC-6). */
export function addEdgeSafe(
  graph: KnowledgeGraph,
  edge: PrerequisiteEdge,
): { ok: boolean; reason?: string } {
  if (wouldCreateCycle(graph, edge)) {
    return { ok: false, reason: "would create a cycle (DAG invariant)" };
  }
  graph.edges.push(edge);
  return { ok: true };
}

// TODO(research-engine): emptyGraph factory, node dedup, persistence helpers.
export function emptyGraph(topicId: string): KnowledgeGraph {
  return { topicId, nodes: [], edges: [], status: "idle" };
}
