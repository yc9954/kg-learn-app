/**
 * Adaptive question generator (PRD §8 step 3, AC-4). Given the built
 * `KnowledgeGraph`, produce 3–5 ADAPTIVE `AssessmentQuestion`s that probe the
 * learner's grasp of the graph's HIGH-LEVERAGE hub concepts (common
 * prerequisites). Adaptive = each next question depends on prior answers: probe
 * deeper (harder) when the learner answers correctly, simpler when they don't.
 *
 * All model calls go through `CopilotProvider.generate` (tier "quality" — the
 * reasoning of a good probe matters) and NO other AI SDK (PRD §4.1).
 *
 * The ontology's `AssessmentQuestion` is the WIRE shape sent to the client and
 * carries no answer key. The scorer needs to know which option is correct and
 * which concept a question probes, so internally we carry a richer
 * `GeneratedQuestion`; only the public projection ever leaves the server.
 */

import { CopilotProvider } from "@/lib/ai/copilot";
import type {
  AssessmentQuestion,
  Concept,
  KnowledgeGraph,
} from "@/lib/ontology/types";

/** A model-call shim so generation can be unit-tested offline with a mock. */
export type GenerateFn = (
  prompt: string,
  opts?: { tier?: "quality" | "fast"; system?: string },
) => Promise<string>;

const defaultGenerate: GenerateFn = (prompt, opts) =>
  CopilotProvider.generate(prompt, opts);

type Difficulty = AssessmentQuestion["difficulty"];

/**
 * Internal, server-only question. Extends the public `AssessmentQuestion` with
 * the answer key + the concept it probes. Never serialized to the client.
 */
export type GeneratedQuestion = AssessmentQuestion & {
  /** Index into `options` of the correct answer. */
  correctIndex: number;
  /** The hub concept id this question is designed to probe. */
  conceptId: string;
};

/** Number of questions in one assessment — a gate, not a course (AC-4: 3–5). */
export const MIN_QUESTIONS = 3;
export const MAX_QUESTIONS = 5;

/* -------------------------------------------------------------------------- */
/* Hub selection — which concepts are highest-leverage to probe               */
/* -------------------------------------------------------------------------- */

/**
 * Rank concepts by "leverage": how many other concepts depend (directly or
 * transitively) on them. A concept that is a prerequisite of many others is a
 * hub — knowing it lets us prune a large subtree, and not knowing it tells us
 * the learner is a beginner. Ties broken by out-degree then name for
 * determinism.
 */
export function rankHubConcepts(graph: KnowledgeGraph): Concept[] {
  const downstream = transitiveDownstreamCounts(graph);
  const outDegree = new Map<string, number>();
  for (const e of graph.edges) {
    outDegree.set(e.from, (outDegree.get(e.from) ?? 0) + 1);
  }
  return [...graph.nodes]
    // Already-known concepts are not worth probing again.
    .filter((c) => !c.known)
    .sort((a, b) => {
      const da = downstream.get(a.id) ?? 0;
      const db = downstream.get(b.id) ?? 0;
      if (da !== db) return db - da;
      const oa = outDegree.get(a.id) ?? 0;
      const ob = outDegree.get(b.id) ?? 0;
      if (oa !== ob) return ob - oa;
      return a.name.localeCompare(b.name);
    });
}

/** For each node, how many concepts are reachable downstream (depend on it). */
function transitiveDownstreamCounts(graph: KnowledgeGraph): Map<string, number> {
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) adj.set(n.id, []);
  for (const e of graph.edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  }
  const counts = new Map<string, number>();
  for (const n of graph.nodes) {
    const seen = new Set<string>();
    const stack = [...(adj.get(n.id) ?? [])];
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const next of adj.get(cur) ?? []) stack.push(next);
    }
    counts.set(n.id, seen.size);
  }
  return counts;
}

/**
 * Choose which hub to probe at question `index`, given prior performance.
 * We walk the hub ranking from the top; the FIRST (most-leveraged) hub is
 * always probed first, then we descend. Concepts already probed are skipped.
 */
function pickConceptForQuestion(
  hubs: Concept[],
  alreadyProbed: Set<string>,
): Concept | null {
  for (const c of hubs) {
    if (!alreadyProbed.has(c.id)) return c;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Adaptive difficulty                                                        */
/* -------------------------------------------------------------------------- */

const ORDER: Difficulty[] = ["beginner", "intermediate", "advanced"];

/**
 * Pick the next question's difficulty adaptively. Start at "intermediate";
 * step UP after a correct answer, DOWN after a wrong one. With no prior answer
 * (first question) we open at "intermediate" to learn the most per question.
 */
export function nextDifficulty(
  prev: Difficulty | null,
  lastCorrect: boolean | null,
): Difficulty {
  if (prev === null || lastCorrect === null) return "intermediate";
  const i = ORDER.indexOf(prev);
  if (lastCorrect) return ORDER[Math.min(i + 1, ORDER.length - 1)];
  return ORDER[Math.max(i - 1, 0)];
}

/* -------------------------------------------------------------------------- */
/* Generation                                                                 */
/* -------------------------------------------------------------------------- */

const QUESTION_SYSTEM = `You are an expert tutor writing ONE multiple-choice
diagnostic question to gauge whether a learner already understands a specific
concept within a topic. Output ONLY strict JSON (no prose, no markdown fences).

Rules:
- The question MUST be answerable from understanding of the concept itself; do
  NOT require outside facts, trivia, or concepts not named.
- Exactly 4 options. Exactly one is correct. Distractors must be plausible.
- Match the requested difficulty:
  - beginner: recognize/define the concept.
  - intermediate: apply or relate the concept.
  - advanced: reason about edge cases, trade-offs, or interactions.
- Keep the stem one or two sentences. Keep options short.`;

type RawQuestion = { question?: string; options?: string[]; correctIndex?: number };

function buildQuestionPrompt(
  topicTitle: string,
  concept: Concept,
  difficulty: Difficulty,
  priorConceptNames: string[],
): string {
  const priors =
    priorConceptNames.length > 0
      ? priorConceptNames.join(", ")
      : "(none yet — this is the first question)";
  return `TOPIC: ${topicTitle}

CONCEPT TO PROBE: ${concept.name}
CONCEPT DEFINITION: ${concept.definition}
CONCEPT SUMMARY: ${concept.summary}

DIFFICULTY: ${difficulty}
ALREADY PROBED THIS SESSION: ${priors}

Write ONE ${difficulty} multiple-choice question that tests whether the learner
understands "${concept.name}". Return JSON shaped exactly:
{"question": string, "options": [string, string, string, string], "correctIndex": 0}
where correctIndex is the 0-based index of the single correct option.`;
}

/** Tolerant JSON extraction (mirrors research/extract.parseExtraction). */
export function parseQuestion(raw: string): RawQuestion {
  if (!raw || !raw.trim()) return {};
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) text = text.slice(first, last + 1);
  try {
    return JSON.parse(text) as RawQuestion;
  } catch {
    return {};
  }
}

/** Strip the answer key — the only shape that may leave the server. */
export function toPublicQuestion(q: GeneratedQuestion): AssessmentQuestion {
  return { id: q.id, text: q.text, options: q.options, difficulty: q.difficulty };
}

/**
 * Generate the NEXT adaptive question for an in-progress assessment.
 *
 * @param graph     the built knowledge graph.
 * @param topicTitle human-readable topic label for prompt context.
 * @param priorQuestions the full questions already asked (server-side).
 * @param lastCorrect whether the most recent answer was correct (null on first).
 * @returns the next `GeneratedQuestion`, or null if no un-probed hub remains.
 */
export async function generateNextQuestion(
  graph: KnowledgeGraph,
  topicTitle: string,
  priorQuestions: GeneratedQuestion[],
  lastCorrect: boolean | null,
  generate: GenerateFn = defaultGenerate,
): Promise<GeneratedQuestion | null> {
  const hubs = rankHubConcepts(graph);
  if (hubs.length === 0) return null;

  const probed = new Set(priorQuestions.map((q) => q.conceptId));
  const concept = pickConceptForQuestion(hubs, probed);
  if (!concept) return null;

  const prevDifficulty =
    priorQuestions.length > 0
      ? priorQuestions[priorQuestions.length - 1].difficulty
      : null;
  const difficulty = nextDifficulty(prevDifficulty, lastCorrect);

  const priorNames = priorQuestions
    .map((q) => graph.nodes.find((n) => n.id === q.conceptId)?.name)
    .filter((x): x is string => !!x);

  let parsed: RawQuestion;
  try {
    const raw = await generate(
      buildQuestionPrompt(topicTitle, concept, difficulty, priorNames),
      { tier: "quality", system: QUESTION_SYSTEM },
    );
    parsed = parseQuestion(raw);
  } catch (err) {
    console.warn("[assessment/questions] generate failed", err);
    return null;
  }

  const options = (Array.isArray(parsed.options) ? parsed.options : [])
    .map((o) => String(o).trim())
    .filter(Boolean);
  const text = (parsed.question ?? "").trim();
  if (!text || options.length < 2) return null;

  let correctIndex = Number.isInteger(parsed.correctIndex)
    ? (parsed.correctIndex as number)
    : 0;
  if (correctIndex < 0 || correctIndex >= options.length) correctIndex = 0;

  return {
    id: `q${priorQuestions.length + 1}-${concept.id}`,
    text,
    options,
    difficulty,
    correctIndex,
    conceptId: concept.id,
  };
}

/**
 * Decide whether the assessment should stop. Stops once we have asked
 * MAX_QUESTIONS, OR once we have asked at least MIN_QUESTIONS and no further
 * un-probed hub concept remains.
 */
export function shouldStop(
  graph: KnowledgeGraph,
  askedCount: number,
  probedConceptIds: Set<string>,
): boolean {
  if (askedCount >= MAX_QUESTIONS) return true;
  if (askedCount < MIN_QUESTIONS) return false;
  const remaining = rankHubConcepts(graph).some((c) => !probedConceptIds.has(c.id));
  return !remaining;
}
