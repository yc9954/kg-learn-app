/**
 * Offline test for the lecture generator — the KEYSTONE gate (PRD §6; AC-9/10).
 * Run with: `npm run test:lectures` (tsx). Exits non-zero on any failure.
 *
 * Uses a MOCKED generate function (no live Foundry keys), so it runs fully
 * offline. Covers:
 *   1. path.ts — pruned topological learning path (known concepts removed).
 *   2. AC-9 KEYSTONE — a FULL generated path has forward-reference = 0:
 *      every lecture passes findForwardReferences(... ) === [] against its
 *      own allow-list, generated one-at-a-time in topo order (AC-10).
 *   3. gate.ts — when the model emits an offender, the gate REGENERATES with
 *      the offender reinforced as forbidden and recovers (attempts > 1).
 *   4. gate.ts — when the model ALWAYS emits an offender, the gate BLOCKS
 *      (throws ForwardReferenceError) and the bad lecture never reaches a user.
 */

import assert from "node:assert/strict";
import type { KnowledgeGraph, UserLevel } from "@/lib/ontology/types";
import { findForwardReferences } from "@/lib/ontology/invariants";
import {
  generateNextLecture,
  generateGatedLecture,
  ForwardReferenceError,
  buildLearningPath,
  allowedConceptIdsFor,
  type GenerateFn,
} from "./index";
import { depthProfileForLevel } from "@/lib/assessment/apply";

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

/* A 5-concept DAG. `sets` is the root hub; `numbers` is independent. */
function fixtureGraph(known: string[] = []): KnowledgeGraph {
  const knownSet = new Set(known);
  const node = (id: string, name: string) => ({
    id,
    name,
    definition: `Definition of ${name}.`,
    summary: `${name} in one line.`,
    known: knownSet.has(id),
  });
  return {
    topicId: "t-lec",
    status: "converged",
    nodes: [
      node("sets", "Sets"),
      node("functions", "Functions"),
      node("relations", "Relations"),
      node("graphs", "Graphs"),
      node("numbers", "Numbers"),
    ],
    edges: [
      { from: "sets", to: "functions" },
      { from: "sets", to: "relations" },
      { from: "relations", to: "graphs" },
    ],
  };
}

function beginnerLevel(knownConceptIds: string[] = []): UserLevel {
  return {
    level: "beginner",
    knownConceptIds,
    depthProfile: depthProfileForLevel("beginner"),
  };
}

/* ── Prompt parsing helpers (the mock reads the allow/forbid lists) ───────── */

function section(prompt: string, header: string, next: string): string {
  const start = prompt.indexOf(header);
  if (start === -1) return "";
  const from = start + header.length;
  const end = prompt.indexOf(next, from);
  return prompt.slice(from, end === -1 ? undefined : end);
}

/** Names listed as "- Name — gloss" inside a section block. */
function namesIn(block: string): string[] {
  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).split(" — ")[0].trim())
    .filter((n) => n && n !== "(none)" && !n.startsWith("(none"));
}

function conceptName(prompt: string): string {
  return (/CONCEPT TO TEACH:\s*(.+)/.exec(prompt)?.[1] ?? "").trim();
}

function allowedNames(prompt: string): string[] {
  return namesIn(section(prompt, "ALLOWED CONCEPTS", "FORBIDDEN CONCEPTS"));
}

function forbiddenNames(prompt: string): string[] {
  return namesIn(section(prompt, "FORBIDDEN CONCEPTS", "DEPTH:"));
}

/**
 * A WELL-BEHAVED mock model: references the concept + every allowed concept
 * name (demonstrating "builds on prior"), never a forbidden one. Emits a
 * Mermaid block + KaTeX so the output exercises AC-11 rendering too.
 */
const goodGenerate: GenerateFn = async (prompt) => {
  const concept = conceptName(prompt);
  const allowed = allowedNames(prompt);
  const builds =
    allowed.length > 0
      ? `It builds on ${allowed.join(", ")}.`
      : "It assumes no prior concepts.";
  return `## ${concept}

${concept} is the idea this lecture teaches. ${builds}

A quick relation: $f(x) = x$ and the display form:

$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$

\`\`\`mermaid
graph TD
  A[Start] --> B[${concept}]
\`\`\`
`;
};

async function run() {
  console.log("lecture-generator offline tests (AC-9 keystone)\n");

  /* ---- 1. path.ts ------------------------------------------------------- */
  // Deterministic assertion (topoSort tie-breaks by name then id).
  await check("buildLearningPath prunes known + keeps topo order", () => {
    const full = buildLearningPath(fixtureGraph());
    // Every prerequisite precedes its dependents.
    assert.ok(full.indexOf("sets") < full.indexOf("functions"));
    assert.ok(full.indexOf("sets") < full.indexOf("relations"));
    assert.ok(full.indexOf("relations") < full.indexOf("graphs"));

    // Pruning: mark `sets` known → it disappears from the path.
    const pruned = buildLearningPath(fixtureGraph(["sets"]));
    assert.ok(!pruned.includes("sets"), "known concept pruned from path");
    assert.ok(pruned.includes("functions"));
  });

  /* ---- 2. AC-9 KEYSTONE: full generated path, forward-reference 0 ------- */
  await check(
    "AC-9: a FULL generated path has forward-reference = 0 (every lecture clean)",
    async () => {
      const graph = fixtureGraph(["sets"]); // learner already knows Sets
      const level = beginnerLevel(["sets"]);
      const path = buildLearningPath(graph);

      const taught: string[] = [];
      const produced: string[] = [];
      let guard = 0;

      while (guard++ < 50) {
        const res = await generateNextLecture(graph, level, taught, goodGenerate);
        if (res.done) break;
        const lec = res.lecture!;
        // Independently re-verify the keystone for THIS lecture.
        const allowed = allowedConceptIdsFor(graph, lec.conceptId, taught);
        const offenders = findForwardReferences(lec, allowed, graph);
        assert.deepEqual(
          offenders,
          [],
          `forward-ref offenders for "${lec.conceptId}": ${offenders.join(", ")}`,
        );
        produced.push(lec.conceptId);
        taught.push(lec.conceptId);
      }

      // One lecture per pruned-path concept, in topological order.
      assert.deepEqual(produced, path, "produced every path concept in topo order");
      console.log(`    → path: [${path.join(" → ")}]  (0 forward-ref offenders)`);
    },
  );

  /* ---- 3. gate regenerates on an offender ------------------------------ */
  await check(
    "gate REGENERATES when the model emits an offender, then recovers",
    async () => {
      const graph = fixtureGraph(["sets"]);
      const concept = graph.nodes.find((n) => n.id === "functions")!;

      let calls = 0;
      const flakyGenerate: GenerateFn = async (prompt) => {
        calls += 1;
        if (calls === 1) {
          // Emit a FORBIDDEN concept name ("Graphs") on the first attempt.
          return `## Functions\n\nThis sneaks in Graphs which is not taught yet.`;
        }
        // The gate should have reinforced "Graphs" as forbidden by now.
        assert.ok(
          forbiddenNames(prompt).includes("Graphs"),
          "offender name reinforced into the forbidden list on retry",
        );
        return goodGenerate(prompt);
      };

      const { lecture, attempts } = await generateGatedLecture(
        {
          concept,
          graph,
          depthProfile: beginnerLevel().depthProfile,
          allowedConceptIds: allowedConceptIdsFor(graph, "functions", []),
          order: 0,
        },
        flakyGenerate,
      );
      assert.equal(attempts, 2, "took a second attempt to clear the gate");
      const offenders = findForwardReferences(
        lecture,
        allowedConceptIdsFor(graph, "functions", []),
        graph,
      );
      assert.deepEqual(offenders, [], "final lecture is forward-ref clean");
    },
  );

  /* ---- 4. gate BLOCKS a persistently-bad lecture ----------------------- */
  await check(
    "gate BLOCKS (throws) when the model ALWAYS emits an offender",
    async () => {
      const graph = fixtureGraph(["sets"]);
      const concept = graph.nodes.find((n) => n.id === "functions")!;
      const badGenerate: GenerateFn = async () =>
        `## Functions\n\nAlways references Graphs and Relations — both forbidden.`;

      await assert.rejects(
        () =>
          generateGatedLecture(
            {
              concept,
              graph,
              depthProfile: beginnerLevel().depthProfile,
              allowedConceptIds: allowedConceptIdsFor(graph, "functions", []),
              order: 0,
            },
            badGenerate,
            3,
          ),
        (err: unknown) => {
          assert.ok(err instanceof ForwardReferenceError, "ForwardReferenceError");
          assert.ok((err as ForwardReferenceError).offenders.length > 0);
          return true;
        },
      );
    },
  );

  console.log(`\n${passed} checks passed.`);
}

run().catch(() => process.exit(1));
