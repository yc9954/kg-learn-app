/**
 * Graph application of an assessment result (PRD §8 step 3, AC-5) — the user's
 * chosen mapping: "known-node pruning + depth adjustment".
 *
 *  1. KNOWN-NODE PRUNING — mark `knownConceptIds` as `known: true` on the graph
 *     nodes. Known nodes are SKIPPED in lectures AND form the
 *     forward-reference baseline (`knownBaseline`): the lecture-generator's
 *     forward-ref-0 check (AC-9) treats known concepts as already-allowed, so
 *     `knownBaseline` is EXACTLY the union of known node ids.
 *  2. DEPTH ADJUSTMENT — derive a `DepthProfile` from the assessed `level`; the
 *     lecture-generator consumes it via the shared `UserLevel` type.
 *
 * Uses the shared ontology types only — never forks `UserLevel`/`DepthProfile`.
 */

import type {
  DepthProfile,
  KnowledgeGraph,
  UserLevel,
} from "@/lib/ontology/types";

/**
 * Map an assessed level to how deep/verbose lectures should be. Beginners get
 * more scaffolding and examples; advanced learners get terse, dense treatment
 * that assumes broad background.
 */
export function depthProfileForLevel(level: UserLevel["level"]): DepthProfile {
  switch (level) {
    case "beginner":
      return {
        assumedBackground:
          "Minimal prior exposure; define jargon before use and motivate each idea from first principles.",
        verbosity: "deep",
        exampleDensity: "high",
      };
    case "advanced":
      return {
        assumedBackground:
          "Strong prior background; the learner already knows foundational concepts and standard terminology.",
        verbosity: "terse",
        exampleDensity: "low",
      };
    case "intermediate":
    default:
      return {
        assumedBackground:
          "Some familiarity with the basics; comfortable with core terminology but not advanced details.",
        verbosity: "normal",
        exampleDensity: "medium",
      };
  }
}

/**
 * Expand a set of demonstrably-known concept ids to include all of their
 * prerequisites (ancestors in the DAG): if the learner knows concept C, they
 * necessarily understand everything C is built on. This makes known-node
 * pruning leverage the graph structure. Returns a sorted, de-duplicated union.
 */
export function expandKnownWithPrerequisites(
  graph: KnowledgeGraph,
  knownConceptIds: Iterable<string>,
): string[] {
  // prerequisite adjacency: dependent (`to`) -> its prerequisites (`from`).
  const prereqs = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!prereqs.has(e.to)) prereqs.set(e.to, []);
    prereqs.get(e.to)!.push(e.from);
  }
  const valid = new Set(graph.nodes.map((n) => n.id));
  const known = new Set<string>();
  const stack: string[] = [];
  for (const id of knownConceptIds) {
    if (valid.has(id)) stack.push(id);
  }
  while (stack.length) {
    const cur = stack.pop()!;
    if (known.has(cur)) continue;
    known.add(cur);
    for (const p of prereqs.get(cur) ?? []) stack.push(p);
  }
  return [...known].sort();
}

export type AppliedAssessment = {
  /** A NEW graph with `known: true` set on every known node (input not mutated). */
  graph: KnowledgeGraph;
  /**
   * The forward-reference baseline: EXACTLY the union of known node ids
   * (sorted). The lecture-generator seeds its allowed-concept set with these.
   */
  knownBaseline: string[];
};

/**
 * Apply a `UserLevel` to a graph: flip `known` flags for the user's known set
 * (expanded with prerequisites) and return the resulting graph plus the
 * `knownBaseline`. Pure — clones the graph rather than mutating the input.
 */
export function applyUserLevel(
  graph: KnowledgeGraph,
  level: UserLevel,
): AppliedAssessment {
  const knownBaseline = expandKnownWithPrerequisites(
    graph,
    level.knownConceptIds,
  );
  const knownSet = new Set(knownBaseline);
  const applied: KnowledgeGraph = {
    ...graph,
    nodes: graph.nodes.map((n) => ({ ...n, known: n.known || knownSet.has(n.id) })),
    edges: graph.edges.map((e) => ({ ...e })),
  };
  return { graph: applied, knownBaseline };
}
