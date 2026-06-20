/**
 * Smoke test for the three keystone invariant guards (PRD §6/§7).
 * Run with: `npm run test:guards` (tsx). Exits non-zero on any failure so CI
 * can block a regression of the forward-reference-0 keystone.
 *
 * Dependency-free: uses node:assert, no test framework needed.
 */
import assert from "node:assert/strict";
import {
  wouldCreateCycle,
  topoSort,
  findForwardReferences,
} from "./invariants";
import type { KnowledgeGraph, Lecture } from "./types";

function concept(id: string, name: string) {
  return { id, name, definition: `${name} def`, summary: `${name} sum`, known: false };
}

// Fixture: a small DAG  a -> b -> d,  a -> c -> d   (a is prereq of b and c; etc.)
const graph: KnowledgeGraph = {
  topicId: "t1",
  status: "converged",
  nodes: [
    concept("a", "Sets"),
    concept("b", "Functions"),
    concept("c", "Relations"),
    concept("d", "Graphs"),
  ],
  edges: [
    { from: "a", to: "b" },
    { from: "a", to: "c" },
    { from: "b", to: "d" },
    { from: "c", to: "d" },
  ],
};

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  \u2713 ${name}`);
}

console.log("guard smoke test:");

// --- Invariant 1: DAG only (wouldCreateCycle) ------------------------------
check("wouldCreateCycle rejects a self-loop", () => {
  assert.equal(wouldCreateCycle(graph, { from: "a", to: "a" }), true);
});
check("wouldCreateCycle rejects a back-edge that closes a loop (d->a)", () => {
  assert.equal(wouldCreateCycle(graph, { from: "d", to: "a" }), true);
});
check("wouldCreateCycle allows a valid new edge (a->d)", () => {
  assert.equal(wouldCreateCycle(graph, { from: "a", to: "d" }), false);
});
check("wouldCreateCycle treats a duplicate edge as non-cyclic", () => {
  assert.equal(wouldCreateCycle(graph, { from: "a", to: "b" }), false);
});

// --- Invariant 2: Topological order (topoSort) -----------------------------
check("topoSort returns all nodes in prerequisite order", () => {
  const order = topoSort(graph);
  assert.equal(order.length, 4);
  const pos = new Map(order.map((id, i) => [id, i] as const));
  for (const e of graph.edges) {
    assert.ok(
      pos.get(e.from)! < pos.get(e.to)!,
      `prerequisite ${e.from} must precede ${e.to}`,
    );
  }
});
check("topoSort throws on a cyclic graph", () => {
  const cyclic: KnowledgeGraph = {
    ...graph,
    edges: [...graph.edges, { from: "d", to: "a" }],
  };
  assert.throws(() => topoSort(cyclic), /not a DAG/);
});

// --- Invariant 3 (KEYSTONE): forward-reference 0 ---------------------------
const lectureForD: Lecture = {
  id: "lec-d",
  conceptId: "d",
  order: 3,
  // References "Functions" (b) and "Relations" (c) — both prerequisites of d.
  markdown:
    "# Graphs\nA graph builds on Functions and Relations introduced earlier.",
};

check("findForwardReferences returns [] when all refs are already taught", () => {
  const offenders = findForwardReferences(lectureForD, ["a", "b", "c"], graph);
  assert.deepEqual(offenders, []);
});
check("findForwardReferences flags a not-yet-taught concept", () => {
  // Only "a" allowed; the lecture references Functions(b) and Relations(c).
  const offenders = findForwardReferences(lectureForD, ["a"], graph);
  assert.deepEqual(offenders, ["b", "c"]);
});
check("findForwardReferences never flags the lecture's own concept", () => {
  const offenders = findForwardReferences(lectureForD, [], {
    ...graph,
    edges: [],
  });
  assert.ok(!offenders.includes("d"));
});

console.log(`\nAll ${passed} guard assertions passed \u2705`);
