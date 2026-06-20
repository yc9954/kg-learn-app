/**
 * Runtime invariant guards (PRD §6 keystone + §7). Every module in the suite
 * upholds these. They are deliberately dependency-free and pure so they can run
 * on the server, in the worker, in tests, and (where useful) on the client.
 *
 * Invariants:
 *  1. DAG only            — wouldCreateCycle()
 *  2. Topological order   — topoSort()
 *  3. forward-reference 0 — findForwardReferences()  (the keystone success rule)
 *  4. Convergence stop    — see research-engine; convergence is enforced there
 *     against a growth threshold + safety budget cap. This file provides the
 *     structural guards the lecture pipeline depends on.
 */

import type { KnowledgeGraph, PrerequisiteEdge, Lecture } from "./types";

/** Build adjacency: prerequisite (`from`) -> dependents (`to`). */
function buildAdjacency(
  nodeIds: Iterable<string>,
  edges: PrerequisiteEdge[],
): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to)) adj.set(e.to, []);
    adj.get(e.from)!.push(e.to);
  }
  return adj;
}

/**
 * INVARIANT 1 — DAG only.
 * Returns true if adding `edge` to `graph` would introduce a cycle and must be
 * rejected. An edge from→to creates a cycle iff `from` is already reachable
 * from `to` (i.e. a path to → … → from already exists), or it is a self-loop.
 */
export function wouldCreateCycle(
  graph: KnowledgeGraph,
  edge: PrerequisiteEdge,
): boolean {
  if (edge.from === edge.to) return true;

  // A duplicate of an existing edge does not create a NEW cycle.
  const exists = graph.edges.some(
    (e) => e.from === edge.from && e.to === edge.to,
  );
  if (exists) return false;

  const adj = buildAdjacency(
    graph.nodes.map((n) => n.id),
    graph.edges,
  );

  // Can we already reach edge.from starting from edge.to? If so, adding
  // edge.from -> edge.to closes a loop.
  const target = edge.from;
  const stack = [edge.to];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === target) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of adj.get(cur) ?? []) stack.push(next);
  }
  return false;
}

/**
 * INVARIANT 2 — Topological order.
 * Returns concept ids ordered so that every prerequisite appears before the
 * concepts that depend on it (Kahn's algorithm). Ties are broken by concept
 * name then id for deterministic, reproducible lecture sequencing.
 * @throws Error if the graph contains a cycle (it must be a DAG).
 */
export function topoSort(graph: KnowledgeGraph): string[] {
  const nameById = new Map(graph.nodes.map((n) => [n.id, n.name] as const));
  const ids = graph.nodes.map((n) => n.id);
  const adj = buildAdjacency(ids, graph.edges);

  const indegree = new Map<string, number>();
  for (const id of adj.keys()) indegree.set(id, 0);
  for (const e of graph.edges) {
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
  }

  const cmp = (a: string, b: string) => {
    const an = nameById.get(a) ?? a;
    const bn = nameById.get(b) ?? b;
    return an === bn ? a.localeCompare(b) : an.localeCompare(bn);
  };

  // Ready set = indegree 0, kept sorted for determinism.
  const ready = [...indegree.entries()]
    .filter(([, d]) => d === 0)
    .map(([id]) => id)
    .sort(cmp);

  const order: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const next of adj.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) {
        ready.push(next);
        ready.sort(cmp);
      }
    }
  }

  if (order.length !== adj.size) {
    throw new Error(
      "topoSort: graph is not a DAG (cycle detected); cannot order lectures.",
    );
  }
  return order;
}

/**
 * Extract concept ids referenced by a lecture's markdown body. We match against
 * the names/ids of concepts that exist in the graph, using case-insensitive,
 * word-boundary matching. This is intentionally conservative: a concept counts
 * as "referenced" only when its full name (or id) appears as a token, so we do
 * not flag incidental substrings.
 */
function referencedConceptIds(
  lecture: Lecture,
  graph: KnowledgeGraph,
): Set<string> {
  const found = new Set<string>();
  const haystack = lecture.markdown.toLowerCase();
  for (const node of graph.nodes) {
    // A lecture never "forward-references" its own concept.
    if (node.id === lecture.conceptId) continue;
    const needles = [node.name, node.id].filter(Boolean);
    for (const needle of needles) {
      const n = needle.toLowerCase().trim();
      if (n.length < 2) continue;
      const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
      if (re.test(haystack)) {
        found.add(node.id);
        break;
      }
    }
  }
  return found;
}

/**
 * INVARIANT 3 (KEYSTONE, PRD §6) — forward-reference 0.
 * A lecture for concept C may reference only concepts in
 * `allowedConceptIds` (= already-taught ∪ known-baseline). Returns the ids of
 * any referenced concepts that are NOT allowed — the offenders. For a valid
 * lecture sequence this MUST be empty. The lecture-generator gates on this and
 * CI asserts zero offenders across a full generated path.
 */
export function findForwardReferences(
  lecture: Lecture,
  allowedConceptIds: string[],
  graph: KnowledgeGraph,
): string[] {
  const allowed = new Set(allowedConceptIds);
  const referenced = referencedConceptIds(lecture, graph);
  const offenders: string[] = [];
  for (const id of referenced) {
    if (!allowed.has(id)) offenders.push(id);
  }
  return offenders.sort();
}
