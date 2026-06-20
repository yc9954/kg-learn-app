/**
 * Offline test for the level assessor (no live Foundry keys needed).
 * Run with: `npm run test:assessment` (tsx). Exits non-zero on any failure.
 *
 * Covers (with a MOCKED CopilotProvider via the injected GenerateFn):
 *  1. questions.ts — hub ranking puts the highest-leverage concept first;
 *     adaptive difficulty steps up on correct / down on wrong; generated public
 *     questions never leak the answer key (AC-4).
 *  2. score.ts — a fixed answer set maps to the expected level + knownConceptIds.
 *  3. apply.ts — known-node pruning flips `known` flags (expanded with
 *     prerequisites) and yields knownBaseline = union of known nodes; depth
 *     profile derives from level (AC-5).
 *  4. end-to-end — graph in → ~4 adaptive questions → level + known set out.
 */

import assert from "node:assert/strict";
import type { KnowledgeGraph } from "@/lib/ontology/types";
import {
  rankHubConcepts,
  nextDifficulty,
  generateNextQuestion,
  parseQuestion,
  toPublicQuestion,
  type GenerateFn,
  type GeneratedQuestion,
} from "./questions";
import { scoreAnswers, isCorrect, levelFromRatio } from "./score";
import {
  applyUserLevel,
  depthProfileForLevel,
  expandKnownWithPrerequisites,
} from "./apply";
import {
  startAssessment,
  answerAndNext,
  finalizeAssessment,
  clearAssessmentSession,
} from "./index";

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

/* A 4-concept fixture where `sets` is the dominant hub (3 downstream). */
function fixtureGraph(topicId = "t1"): KnowledgeGraph {
  return {
    topicId,
    status: "converged",
    nodes: [
      { id: "sets", name: "Sets", definition: "d", summary: "s", known: false },
      { id: "functions", name: "Functions", definition: "d", summary: "s", known: false },
      { id: "relations", name: "Relations", definition: "d", summary: "s", known: false },
      { id: "graphs", name: "Graphs", definition: "d", summary: "s", known: false },
    ],
    edges: [
      { from: "sets", to: "functions" },
      { from: "sets", to: "relations" },
      { from: "relations", to: "graphs" },
    ],
  };
}

/** Mock model: always returns a well-formed question; correct option = index 1. */
const mockGenerate: GenerateFn = async () =>
  JSON.stringify({
    question: "Which best describes the concept?",
    options: ["wrong-a", "the-correct-one", "wrong-c", "wrong-d"],
    correctIndex: 1,
  });

/** Build a GeneratedQuestion fixture (for pure scorer tests). */
function genQ(
  conceptId: string,
  difficulty: GeneratedQuestion["difficulty"],
): GeneratedQuestion {
  return {
    id: `q-${conceptId}`,
    text: "?",
    options: ["a", "b", "c", "d"],
    difficulty,
    correctIndex: 1,
    conceptId,
  };
}

async function run() {
  console.log("level-assessor offline tests\n");

  /* ---- 1. questions.ts -------------------------------------------------- */
  await check("rankHubConcepts puts the highest-leverage hub first", () => {
    const hubs = rankHubConcepts(fixtureGraph());
    assert.equal(hubs[0].id, "sets", "sets has the most downstream concepts");
    // known concepts are excluded from probing
    const g = fixtureGraph();
    g.nodes[0].known = true;
    assert.ok(!rankHubConcepts(g).some((c) => c.id === "sets"));
  });

  await check("nextDifficulty: intermediate start, up on correct, down on wrong", () => {
    assert.equal(nextDifficulty(null, null), "intermediate");
    assert.equal(nextDifficulty("intermediate", true), "advanced");
    assert.equal(nextDifficulty("advanced", true), "advanced"); // capped
    assert.equal(nextDifficulty("intermediate", false), "beginner");
    assert.equal(nextDifficulty("beginner", false), "beginner"); // floored
  });

  await check("parseQuestion tolerates fenced / noisy JSON", () => {
    const r = parseQuestion('ok\n```json\n{"question":"x","options":["a","b"],"correctIndex":0}\n```');
    assert.equal(r.question, "x");
    assert.equal(r.options?.length, 2);
  });

  await check("generateNextQuestion targets top hub + hides the answer key", async () => {
    const q = await generateNextQuestion(fixtureGraph(), "Math", [], null, mockGenerate);
    assert.ok(q);
    assert.equal(q!.conceptId, "sets");
    assert.equal(q!.difficulty, "intermediate"); // first question
    assert.equal(q!.correctIndex, 1);
    const pub = toPublicQuestion(q!);
    assert.ok(!("correctIndex" in pub), "public question must not leak the answer");
    assert.ok(!("conceptId" in pub));
    assert.equal(pub.options.length, 4);
  });

  /* ---- 2. score.ts ------------------------------------------------------ */
  await check("isCorrect matches by index and by option text", () => {
    const q = genQ("sets", "beginner"); // correct = options[1] = "b"
    assert.equal(isCorrect(q, 1), true);
    assert.equal(isCorrect(q, "b"), true);
    assert.equal(isCorrect(q, "B"), true);
    assert.equal(isCorrect(q, 0), false);
    assert.equal(isCorrect(q, "a"), false);
  });

  await check("levelFromRatio thresholds", () => {
    assert.equal(levelFromRatio(0.2), "beginner");
    assert.equal(levelFromRatio(0.5), "intermediate");
    assert.equal(levelFromRatio(0.9), "advanced");
  });

  await check("scoreAnswers: fixed answers → expected level + knownConceptIds", () => {
    const g = fixtureGraph();
    // beginner-correct(1) + intermediate-correct(2) + advanced-wrong(0/3) → 3/6 = 0.5 → intermediate
    const level = scoreAnswers(g, [
      { question: genQ("sets", "beginner"), answer: 1 }, // correct
      { question: genQ("relations", "intermediate"), answer: "b" }, // correct
      { question: genQ("graphs", "advanced"), answer: 0 }, // wrong
    ]);
    assert.equal(level.level, "intermediate");
    assert.deepEqual(level.knownConceptIds, ["relations", "sets"]);
    assert.equal(level.depthProfile.verbosity, "normal");
  });

  await check("scoreAnswers: all correct → advanced, all wrong → beginner", () => {
    const g = fixtureGraph();
    const all = [genQ("sets", "advanced"), genQ("relations", "advanced")];
    const adv = scoreAnswers(g, all.map((q) => ({ question: q, answer: 1 })));
    assert.equal(adv.level, "advanced");
    const beg = scoreAnswers(g, all.map((q) => ({ question: q, answer: 0 })));
    assert.equal(beg.level, "beginner");
    assert.deepEqual(beg.knownConceptIds, []);
  });

  /* ---- 3. apply.ts ------------------------------------------------------ */
  await check("expandKnownWithPrerequisites pulls in ancestors", () => {
    const g = fixtureGraph();
    // knowing `graphs` implies knowing relations + sets (its prerequisites).
    assert.deepEqual(expandKnownWithPrerequisites(g, ["graphs"]), [
      "graphs",
      "relations",
      "sets",
    ]);
  });

  await check("applyUserLevel flips known flags + knownBaseline = union of known", () => {
    const g = fixtureGraph();
    const { graph, knownBaseline } = applyUserLevel(g, {
      level: "intermediate",
      knownConceptIds: ["relations"], // → expands to relations + sets
      depthProfile: depthProfileForLevel("intermediate"),
    });
    assert.deepEqual(knownBaseline, ["relations", "sets"]);
    const known = graph.nodes.filter((n) => n.known).map((n) => n.id).sort();
    assert.deepEqual(known, knownBaseline, "knownBaseline == union of known nodes");
    // input graph not mutated
    assert.ok(g.nodes.every((n) => !n.known));
  });

  await check("depthProfileForLevel maps level → depth", () => {
    assert.equal(depthProfileForLevel("beginner").verbosity, "deep");
    assert.equal(depthProfileForLevel("beginner").exampleDensity, "high");
    assert.equal(depthProfileForLevel("advanced").verbosity, "terse");
  });

  /* ---- 4. end-to-end adaptive flow ------------------------------------- */
  await check("graph in → ~4 adaptive questions → level + known set out (AC-4/5)", async () => {
    const g = fixtureGraph("e2e");
    clearAssessmentSession("e2e");

    const first = await startAssessment(g, "Math", mockGenerate);
    assert.equal(first.done, false);
    assert.ok(first.question);

    let current = first.question!;
    let count = 1;
    // Answer every question correctly (option index 1 per the mock).
    while (true) {
      const res = await answerAndNext(g, "Math", current.id, 1, mockGenerate);
      if (res.done) break;
      current = res.question;
      count += 1;
      assert.ok(count <= 5, "never exceeds MAX_QUESTIONS");
    }
    assert.ok(count >= 3 && count <= 5, `asked ${count} questions (must be 3–5)`);

    const level = finalizeAssessment(g);
    assert.equal(level.level, "advanced", "all-correct → advanced");
    assert.ok(level.knownConceptIds.includes("sets"), "top hub marked known");

    const { graph, knownBaseline } = applyUserLevel(g, level);
    assert.deepEqual(
      graph.nodes.filter((n) => n.known).map((n) => n.id).sort(),
      knownBaseline,
    );
    console.log(
      `    → asked ${count} questions; level=${level.level}; ` +
        `known={${knownBaseline.join(", ")}}`,
    );
  });

  console.log(`\n${passed} checks passed.`);
}

run().catch(() => process.exit(1));
