/**
 * Scorer (PRD §8 step 3, AC-5). Turns the learner's answers to the adaptive
 * questions into a `UserLevel`:
 *   - `level`        : beginner | intermediate | advanced (difficulty-weighted).
 *   - `knownConceptIds`: the hub concepts the learner demonstrably already knows
 *                        (answered the probing question correctly).
 *   - `depthProfile` : derived from `level` (via apply.depthProfileForLevel).
 *
 * The expansion of known concepts to their prerequisites and the flipping of
 * `known` flags live in `apply.ts`; this module only reports what was
 * *demonstrated*. Uses shared ontology types only — never forks `UserLevel`.
 */

import type { KnowledgeGraph, UserLevel } from "@/lib/ontology/types";
import type { GeneratedQuestion } from "./questions";
import { depthProfileForLevel } from "./apply";

/** An answer is either the chosen option's text or its 0-based index. */
export type Answer = string | number;

/** One answered question, paired with the (server-held) full question. */
export type AnsweredQuestion = {
  question: GeneratedQuestion;
  answer: Answer;
};

/** Difficulty → weight: harder questions count for more. */
const WEIGHT: Record<GeneratedQuestion["difficulty"], number> = {
  beginner: 1,
  intermediate: 2,
  advanced: 3,
};

/** Whether an answer matches the question's correct option (index or text). */
export function isCorrect(question: GeneratedQuestion, answer: Answer): boolean {
  const correct = question.options[question.correctIndex];
  if (typeof answer === "number") return answer === question.correctIndex;
  const a = answer.trim().toLowerCase();
  if (!a) return false;
  // Accept the exact option text, or a stringified index ("2").
  if (a === String(correct).trim().toLowerCase()) return true;
  const asIndex = Number(a);
  return Number.isInteger(asIndex) && asIndex === question.correctIndex;
}

/**
 * Map a difficulty-weighted correctness ratio to a level. Generous-but-honest
 * thresholds keep the gate short: you must get the harder questions right to be
 * rated advanced.
 */
export function levelFromRatio(ratio: number): UserLevel["level"] {
  if (ratio >= 0.75) return "advanced";
  if (ratio >= 0.4) return "intermediate";
  return "beginner";
}

/**
 * Score a completed assessment into a `UserLevel`. Pure and deterministic — no
 * model call — so it is fully unit-testable offline.
 */
export function scoreAnswers(
  graph: KnowledgeGraph,
  answered: AnsweredQuestion[],
): UserLevel {
  const validIds = new Set(graph.nodes.map((n) => n.id));

  let earned = 0;
  let possible = 0;
  const knownConceptIds = new Set<string>();

  for (const { question, answer } of answered) {
    const w = WEIGHT[question.difficulty] ?? 1;
    possible += w;
    if (isCorrect(question, answer)) {
      earned += w;
      if (validIds.has(question.conceptId)) knownConceptIds.add(question.conceptId);
    }
  }

  const ratio = possible > 0 ? earned / possible : 0;
  const level = levelFromRatio(ratio);

  return {
    level,
    knownConceptIds: [...knownConceptIds].sort(),
    depthProfile: depthProfileForLevel(level),
  };
}
