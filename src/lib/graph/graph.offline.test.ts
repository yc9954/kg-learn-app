/**
 * Offline test for the live-graph SSE event → state reducer (AC-7/8; AC-6
 * display guard). No browser, no DOM, no keys needed — pure logic only.
 * Run with: `npm run test:graph` (tsx). Exits non-zero on any failure.
 *
 * Covers:
 *  1. node events upsert by id (no duplicates on replay/reconnect).
 *  2. edge events dedupe by from|to and render in arrival order.
 *  3. a cycle-forming edge is REJECTED and surfaced via `error` (AC-6), never
 *     added to the rendered edge set.
 *  4. status events drive idle → researching → converged.
 *  5. stateFromGraph seeds a static render path.
 */

import assert from "node:assert/strict";
import {
  initialGraphStreamState,
  reduceGraphEvent,
  isTerminalStatus,
  stateFromGraph,
} from "./reducer";
import type { Concept, GraphEvent, KnowledgeGraph } from "@/lib/ontology/types";

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function concept(id: string, name = id, known = false): Concept {
  return { id, name, definition: `${name} def`, summary: `${name} sum`, known };
}
const node = (c: Concept, ts = Date.now()): GraphEvent => ({
  type: "node",
  payload: c,
  ts,
});
const edge = (from: string, to: string, ts = Date.now()): GraphEvent => ({
  type: "edge",
  payload: { from, to },
  ts,
});
const statusEv = (
  payload: KnowledgeGraph["status"],
  ts = Date.now(),
): GraphEvent => ({ type: "status", payload, ts });

function fold(events: GraphEvent[]) {
  return events.reduce(reduceGraphEvent, initialGraphStreamState);
}

console.log("graph reducer (offline):");

check("upserts nodes by id; ignores exact-duplicate replays", () => {
  const s = fold([node(concept("a")), node(concept("b")), node(concept("a"))]);
  assert.equal(s.nodes.length, 2);
  assert.deepEqual(
    s.nodes.map((n) => n.id),
    ["a", "b"],
  );
});

check("upsert replaces a node when its payload changes", () => {
  const s = fold([
    node(concept("a", "Old")),
    node({ ...concept("a", "New"), known: true }),
  ]);
  assert.equal(s.nodes.length, 1);
  assert.equal(s.nodes[0].name, "New");
  assert.equal(s.nodes[0].known, true);
});

check("adds edges and dedupes by from|to", () => {
  const s = fold([
    node(concept("a")),
    node(concept("b")),
    edge("a", "b"),
    edge("a", "b"), // duplicate replay
  ]);
  assert.equal(s.edges.length, 1);
  assert.deepEqual(s.edges[0], { from: "a", to: "b" });
  assert.equal(s.error, null);
});

check("rejects a cycle-forming edge and reports it via error (AC-6)", () => {
  const s = fold([
    node(concept("a")),
    node(concept("b")),
    edge("a", "b"),
    edge("b", "a"), // would create a cycle
  ]);
  assert.equal(s.edges.length, 1, "cycle edge must not be rendered");
  assert.ok(s.error && /cycle/i.test(s.error), "error should mention cycle");
});

check("status events drive the lifecycle", () => {
  let s = fold([statusEv("researching")]);
  assert.equal(s.status, "researching");
  s = reduceGraphEvent(s, statusEv("converged"));
  assert.equal(s.status, "converged");
  assert.equal(isTerminalStatus("converged"), true);
  assert.equal(isTerminalStatus("stopped"), true);
  assert.equal(isTerminalStatus("researching"), false);
});

check("replay-then-tail reconciles without duplicates", () => {
  // Simulate: snapshot replay (a,b,edge) then a live new node + edge.
  const replay = fold([node(concept("a")), node(concept("b")), edge("a", "b")]);
  const next = [node(concept("a")), node(concept("c")), edge("b", "c")].reduce(
    reduceGraphEvent,
    replay,
  );
  assert.equal(next.nodes.length, 3);
  assert.equal(next.edges.length, 2);
});

check("stateFromGraph seeds the static render path", () => {
  const graph: KnowledgeGraph = {
    topicId: "t",
    status: "converged",
    nodes: [concept("a"), concept("b")],
    edges: [{ from: "a", to: "b" }],
  };
  const s = stateFromGraph(graph);
  assert.equal(s.nodes.length, 2);
  assert.equal(s.edges.length, 1);
  assert.equal(s.status, "converged");
});

if (process.exitCode) {
  console.error(`\ngraph reducer: FAILED`);
} else {
  console.log(`\ngraph reducer: ${passed} checks passed`);
}
