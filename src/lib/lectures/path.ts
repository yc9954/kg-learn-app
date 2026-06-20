/**
 * Learning-path builder (PRD §8 step 5; AC-10). The path is the topological
 * order of the knowledge graph (so every prerequisite precedes its dependents),
 * with all ALREADY-KNOWN concepts PRUNED — the learner is never taught what the
 * assessment proved they already understand.
 *
 * The pruned topo order IS the lecture sequence. The lecture-generator walks it
 * one concept at a time; the forward-ref-0 baseline for the concept at position
 * i is `knownBaseline ∪ {concepts at positions < i}` (see gate.ts).
 *
 * Imports `topoSort()` from the shared ontology — never re-implements ordering.
 */

import { topoSort } from "@/lib/ontology/invariants";
import type { KnowledgeGraph } from "@/lib/ontology/types";

/** Concept ids that the learner already knows (the forward-ref baseline). */
export function knownBaselineIds(graph: KnowledgeGraph): string[] {
  return graph.nodes.filter((n) => n.known).map((n) => n.id);
}

/**
 * The ordered concept ids to TEACH: full topological order minus known
 * concepts. Deterministic (topoSort breaks ties by name then id).
 *
 * @throws if the graph is not a DAG (topoSort rejects cycles).
 */
export function buildLearningPath(graph: KnowledgeGraph): string[] {
  const known = new Set(knownBaselineIds(graph));
  return topoSort(graph).filter((id) => !known.has(id));
}

/**
 * The next concept to teach, given the ids already taught this session. Returns
 * the first concept in the pruned path that has not yet been taught, or null
 * when the learner has completed the path.
 */
export function nextConceptId(
  graph: KnowledgeGraph,
  alreadyTaughtConceptIds: Iterable<string>,
): string | null {
  const taught = new Set(alreadyTaughtConceptIds);
  for (const id of buildLearningPath(graph)) {
    if (!taught.has(id)) return id;
  }
  return null;
}

/**
 * The forward-reference allow-list for a concept: every concept the learner may
 * be assumed to understand when this lecture is read = known baseline ∪ all
 * concepts taught BEFORE it in the pruned path. Used to seed the gate.
 */
export function allowedConceptIdsFor(
  graph: KnowledgeGraph,
  conceptId: string,
  alreadyTaughtConceptIds: Iterable<string>,
): string[] {
  const allowed = new Set<string>(knownBaselineIds(graph));
  for (const id of alreadyTaughtConceptIds) {
    if (id !== conceptId) allowed.add(id);
  }
  // A concept never forward-references itself; exclude defensively.
  allowed.delete(conceptId);
  return [...allowed].sort();
}
