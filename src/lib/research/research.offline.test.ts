/**
 * Offline test for the research engine (no live Foundry/Tavily keys needed).
 * Run with: `npm run test:research` (tsx). Exits non-zero on any failure.
 *
 * Covers:
 *  1. extractConcepts with a MOCKED model provider — parses JSON, dedupes by
 *     normalized name, assigns slug ids, and REJECTS cycle-forming edges (AC-6).
 *  2. ConvergenceTracker on synthetic rounds — converges on low growth and
 *     STOPS on each safety budget cap, budget winning first (AC-3).
 *  3. runResearch end-to-end with injected search + extract — emits node/edge/
 *     status GraphEvents in real time and ends in a terminal status (AC-2/7).
 */

import assert from "node:assert/strict";
import {
  extractConcepts,
  normalizeName,
  type GenerateFn,
} from "./extract";
import {
  ConvergenceTracker,
  DEFAULT_BUDGET,
} from "./convergence";
import { runResearch } from "./orchestrate";
import type {
  GraphEvent,
  KnowledgeGraph,
  WebSource,
} from "@/lib/ontology/types";

let passed = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      console.error(err);
      process.exitCode = 1;
      throw err;
    });
}

const emptyGraph = (topicId = "t1"): KnowledgeGraph => ({
  topicId,
  nodes: [],
  edges: [],
  status: "researching",
});

const SOURCES: WebSource[] = [
  { url: "https://example.com/a", title: "Intro", snippet: "about sets and functions" },
];

async function run() {
  console.log("research-engine offline tests\n");

  /* ---- 1. extractConcepts: dedupe + slug ids + cycle rejection ---------- */
  await check("normalizeName de-pluralizes + canonicalizes", () => {
    assert.equal(normalizeName("Graphs"), normalizeName("graph"));
    assert.equal(normalizeName("Set Theory!"), "set theory");
  });

  await check("extract parses JSON, dedupes, assigns ids", async () => {
    const mock: GenerateFn = async () =>
      JSON.stringify({
        concepts: [
          { name: "Sets", definition: "d1", summary: "s1" },
          { name: "Functions", definition: "d2", summary: "s2" },
          { name: "sets", definition: "dup", summary: "dup" }, // duplicate
        ],
        edges: [{ from: "Sets", to: "Functions" }],
      });
    const res = await extractConcepts("math", SOURCES, emptyGraph(), mock);
    assert.equal(res.newConcepts.length, 2, "duplicate 'sets' must be merged");
    assert.equal(res.newEdges.length, 1);
    const ids = res.newConcepts.map((c) => c.id);
    assert.ok(ids.includes("sets") && ids.includes("functions"));
    // every concept tagged with the source that justified it
    for (const c of res.newConcepts) {
      assert.ok((res.conceptSources.get(c.id) ?? []).length >= 1);
    }
  });

  await check("extract rejects cycle-forming edges (DAG only, AC-6)", async () => {
    const mock: GenerateFn = async () =>
      JSON.stringify({
        concepts: [
          { name: "A", definition: "", summary: "" },
          { name: "B", definition: "", summary: "" },
        ],
        // A->B and B->A : the second closes a cycle and must be rejected.
        edges: [
          { from: "A", to: "B" },
          { from: "B", to: "A" },
        ],
      });
    const res = await extractConcepts("x", SOURCES, emptyGraph(), mock);
    assert.equal(res.newEdges.length, 1, "only one of the two edges is DAG-safe");
    assert.ok(res.rejectedEdges.some((r) => r.reason.includes("cycle")));
  });

  await check("extract tolerates fenced / noisy JSON", async () => {
    const mock: GenerateFn = async () =>
      "Sure!\n```json\n{\"concepts\":[{\"name\":\"Vectors\"}],\"edges\":[]}\n```\nDone.";
    const res = await extractConcepts("la", SOURCES, emptyGraph(), mock);
    assert.equal(res.newConcepts.length, 1);
    assert.equal(res.newConcepts[0].id, "vectors");
  });

  /* ---- 2. ConvergenceTracker on synthetic rounds ------------------------ */
  await check("converges after low-growth rounds (default patience=2)", () => {
    const t = new ConvergenceTracker(); // defaults: <1/round for 2 rounds
    let d = t.recordRound({ newConcepts: 5, sourcesUsed: 3 });
    assert.equal(d.done, false);
    d = t.recordRound({ newConcepts: 0, sourcesUsed: 2 });
    assert.equal(d.done, false, "one low round is not enough");
    d = t.recordRound({ newConcepts: 0, sourcesUsed: 2 });
    assert.equal(d.done, true);
    assert.equal(d.status, "converged");
    assert.equal(d.reason, "converged");
  });

  await check("budget cap (maxConcepts) stops first → status 'stopped'", () => {
    const t = new ConvergenceTracker({ maxConcepts: 4 });
    const d = t.recordRound({ newConcepts: 5, sourcesUsed: 1 });
    assert.equal(d.done, true);
    assert.equal(d.status, "stopped");
    assert.equal(d.reason, "max_concepts");
  });

  await check("budget cap (maxWallClock) stops on elapsed time", () => {
    const start = 1_000;
    const t = new ConvergenceTracker({ maxWallClockMs: 100 }, start);
    const d = t.recordRound({ newConcepts: 1, sourcesUsed: 1 }, start + 200);
    assert.equal(d.status, "stopped");
    assert.equal(d.reason, "max_wallclock");
  });

  await check("defaults are present and sane", () => {
    assert.ok(DEFAULT_BUDGET.maxConcepts > 0);
    assert.ok(DEFAULT_BUDGET.patience >= 1);
    assert.ok(DEFAULT_BUDGET.maxWallClockMs > 0);
  });

  /* ---- 3. runResearch end-to-end with injected deps (stream-first) ------ */
  await check("runResearch streams node/edge/status events (AC-2/7)", async () => {
    // Deterministic injected extractor: round 1 yields 2 concepts + 1 edge,
    // subsequent rounds yield nothing → convergence.
    let round = 0;
    const events: GraphEvent[] = [];
    const result = await runResearch({
      topicId: "tX",
      topic: "graph theory",
      parallelAgents: 1,
      budget: { patience: 1, maxRounds: 5 },
      deps: {
        useAgent: false,
        search: async () => SOURCES,
        extract: async () => {
          round += 1;
          if (round === 1) {
            return {
              newConcepts: [
                { id: "nodes", name: "Nodes", definition: "", summary: "", known: false },
                { id: "edges", name: "Edges", definition: "", summary: "", known: false },
              ],
              newEdges: [{ from: "nodes", to: "edges" }],
              conceptSources: new Map([
                ["nodes", SOURCES],
                ["edges", SOURCES],
              ]),
              rejectedEdges: [],
            };
          }
          return {
            newConcepts: [],
            newEdges: [],
            conceptSources: new Map(),
            rejectedEdges: [],
          };
        },
      },
      onEvent: (e) => {
        events.push(e);
      },
    });

    const nodes = events.filter((e) => e.type === "node");
    const edges = events.filter((e) => e.type === "edge");
    const statuses = events.filter((e) => e.type === "status");
    assert.equal(nodes.length, 2, "2 node events streamed");
    assert.equal(edges.length, 1, "1 edge event streamed");
    assert.ok(statuses.length >= 2, "researching + terminal status emitted");
    assert.equal(events[0].type, "status"); // first event is 'researching'
    assert.equal(result.status, "converged");
    assert.equal(result.graph.nodes.length, 2);
    assert.equal(result.graph.edges.length, 1);
    // node before its edge (stream order matters for the live viz)
    const firstEdgeIdx = events.findIndex((e) => e.type === "edge");
    const lastNodeIdx = events.map((e) => e.type).lastIndexOf("node");
    assert.ok(lastNodeIdx < firstEdgeIdx, "nodes stream before edges");
  });

  await check("runResearch works with NO search (Copilot-SDK-only)", async () => {
    // No `search` dep, no provider, useAgent omitted → pure knowledge mode.
    // The injected extractor must still receive a non-empty `focus` (frontier).
    let round = 0;
    const focuses: (string | undefined)[] = [];
    const events: GraphEvent[] = [];
    const result = await runResearch({
      topicId: "tY",
      topic: "linear algebra",
      parallelAgents: 1,
      budget: { patience: 1, maxRounds: 5 },
      deps: {
        extract: async (_topic, sources, _graph, focus) => {
          round += 1;
          focuses.push(focus);
          // Knowledge mode must NOT pass any web sources to the extractor.
          assert.equal(sources.length, 0, "no web sources in SDK-only mode");
          if (round === 1) {
            return {
              newConcepts: [
                { id: "scalars", name: "Scalars", definition: "", summary: "", known: false },
              ],
              newEdges: [],
              conceptSources: new Map(),
              rejectedEdges: [],
            };
          }
          return {
            newConcepts: [],
            newEdges: [],
            conceptSources: new Map(),
            rejectedEdges: [],
          };
        },
      },
      onEvent: (e) => {
        events.push(e);
      },
    });
    assert.equal(result.graph.nodes.length, 1);
    assert.ok(typeof focuses[0] === "string" && focuses[0].length > 0,
      "frontier focus passed to extractor");
    assert.ok(
      ["converged", "stopped"].includes(result.status),
      "ends in a terminal status without any search provider",
    );
  });

  await check("extract uses model knowledge when sources are empty", async () => {
    // With no sources, the prompt must still ask the model to use its knowledge
    // and the extractor must produce concepts from the mocked model output.
    let seenPrompt = "";
    const mock: GenerateFn = async (prompt) => {
      seenPrompt = prompt;
      return JSON.stringify({ concepts: [{ name: "Vectors" }], edges: [] });
    };
    const res = await extractConcepts("linear algebra", [], emptyGraph(), mock, "Vectors");
    assert.equal(res.newConcepts.length, 1);
    assert.ok(/your own expert knowledge/i.test(seenPrompt), "knowledge-mode prompt");
    assert.ok(/FOCUS:/.test(seenPrompt), "focus included in prompt");
  });

  console.log(`\n${passed} checks passed.`);
}

run().catch(() => process.exit(1));
