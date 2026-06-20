/**
 * Level assessor — public surface + adaptive-session orchestration
 * (PRD §8 step 3, AC-4/5).
 *
 * The assessment is an upfront, ADAPTIVE gate (3–5 questions) that runs BEFORE
 * any lecture and feeds BOTH the known-node baseline and the lecture depth:
 *   questions.ts → generate adaptive hub-targeted questions (CopilotProvider).
 *   score.ts     → answers → UserLevel (level + knownConceptIds + depthProfile).
 *   apply.ts     → known-node pruning + depth adjustment → graph + knownBaseline.
 *
 * Because the flow is adaptive (each next question depends on prior answers) and
 * served one question at a time over HTTP, the server holds the in-progress
 * questions (with their answer keys) in a process-local store keyed by topicId.
 * Only answer-key-stripped `AssessmentQuestion`s ever reach the client. The
 * final `UserLevel` + known flags are persisted durably by the route layer.
 *
 * This module is framework- and DB-agnostic (no `server-only`, no Prisma) so it
 * is unit-testable offline with a mocked `GenerateFn`.
 */

import type {
  AssessmentQuestion,
  KnowledgeGraph,
  UserLevel,
} from "@/lib/ontology/types";
import {
  generateNextQuestion,
  shouldStop,
  toPublicQuestion,
  type GenerateFn,
  type GeneratedQuestion,
} from "./questions";
import { scoreAnswers, isCorrect, type Answer, type AnsweredQuestion } from "./score";
import { applyUserLevel, depthProfileForLevel } from "./apply";

export * from "./questions";
export * from "./score";
export * from "./apply";

/* -------------------------------------------------------------------------- */
/* In-progress assessment session store (process-local)                       */
/* -------------------------------------------------------------------------- */

type AssessmentSession = {
  asked: GeneratedQuestion[];
  answers: Map<string, Answer>;
};

const globalForAssessment = globalThis as unknown as {
  __kgAssessmentSessions?: Map<string, AssessmentSession>;
};
const sessions: Map<string, AssessmentSession> =
  globalForAssessment.__kgAssessmentSessions ??
  (globalForAssessment.__kgAssessmentSessions = new Map());

function freshSession(topicId: string): AssessmentSession {
  const s: AssessmentSession = { asked: [], answers: new Map() };
  sessions.set(topicId, s);
  return s;
}

function probedIds(session: AssessmentSession): Set<string> {
  return new Set(session.asked.map((q) => q.conceptId));
}

/* -------------------------------------------------------------------------- */
/* Orchestration                                                              */
/* -------------------------------------------------------------------------- */

export type NextQuestionResult =
  | { done: false; question: AssessmentQuestion }
  | { done: true; question: null };

/**
 * Start (or restart) an assessment for a topic and return the first adaptive
 * question. Resets any prior in-progress session for the topic.
 */
export async function startAssessment(
  graph: KnowledgeGraph,
  topicTitle: string,
  generate?: GenerateFn,
): Promise<NextQuestionResult> {
  const session = freshSession(graph.topicId);
  const q = await generateNextQuestion(graph, topicTitle, [], null, generate);
  if (!q) return { done: true, question: null };
  session.asked.push(q);
  return { done: false, question: toPublicQuestion(q) };
}

/**
 * Record the answer to the most recent question, then either return the next
 * adaptive question (harder if correct, simpler if not) or signal that the
 * assessment is complete (≥MIN questions and no hub left, or MAX reached).
 */
export async function answerAndNext(
  graph: KnowledgeGraph,
  topicTitle: string,
  questionId: string,
  answer: Answer,
  generate?: GenerateFn,
): Promise<NextQuestionResult> {
  const session = sessions.get(graph.topicId);
  if (!session) {
    throw new Error(
      `No active assessment for topic ${graph.topicId}; call startAssessment first.`,
    );
  }
  const current = session.asked.find((q) => q.id === questionId);
  if (!current) {
    throw new Error(`Unknown questionId ${questionId} for topic ${graph.topicId}.`);
  }
  session.answers.set(questionId, answer);

  if (shouldStop(graph, session.asked.length, probedIds(session))) {
    return { done: true, question: null };
  }

  const lastCorrect = isCorrect(current, answer);
  const next = await generateNextQuestion(
    graph,
    topicTitle,
    session.asked,
    lastCorrect,
    generate,
  );
  if (!next) return { done: true, question: null };
  session.asked.push(next);
  return { done: false, question: toPublicQuestion(next) };
}

/**
 * Score the completed session into a `UserLevel`. Throws if there is no session
 * with at least one answered question.
 */
export function finalizeAssessment(graph: KnowledgeGraph): UserLevel {
  const session = sessions.get(graph.topicId);
  const answered: AnsweredQuestion[] = [];
  if (session) {
    for (const q of session.asked) {
      const answer = session.answers.get(q.id);
      if (answer !== undefined) answered.push({ question: q, answer });
    }
  }
  if (answered.length === 0) {
    throw new Error(
      `No answered questions for topic ${graph.topicId}; cannot finalize.`,
    );
  }
  return scoreAnswers(graph, answered);
}

/** Discard a topic's in-progress assessment session (e.g. after finalize). */
export function clearAssessmentSession(topicId: string): void {
  sessions.delete(topicId);
}

/* -------------------------------------------------------------------------- */
/* Backwards-compatible convenience helpers (stub API kept stable)            */
/* -------------------------------------------------------------------------- */

/**
 * One-shot helper: generate up to MAX adaptive questions for a graph WITHOUT a
 * live respondent (each step assumes the prior answer was correct, so it probes
 * progressively deeper hubs). Returns the public questions. Used where a simple
 * batch of questions is enough; the live route uses the start/answer flow.
 */
export async function generateAssessment(
  graph: KnowledgeGraph,
  topicTitle = graph.topicId,
  generate?: GenerateFn,
): Promise<AssessmentQuestion[]> {
  const asked: GeneratedQuestion[] = [];
  let lastCorrect: boolean | null = null;
  while (!shouldStop(graph, asked.length, new Set(asked.map((q) => q.conceptId)))) {
    const q = await generateNextQuestion(graph, topicTitle, asked, lastCorrect, generate);
    if (!q) break;
    asked.push(q);
    lastCorrect = true; // probe deeper next; no respondent in batch mode.
  }
  return asked.map(toPublicQuestion);
}

/**
 * One-shot helper: score a flat answers map ({questionId → answer}) against the
 * topic's in-progress session into a `UserLevel`. Prefer the route flow; this
 * keeps the original `scoreAssessment(graph, answers)` signature usable.
 */
export function scoreAssessment(
  graph: KnowledgeGraph,
  answers: Record<string, Answer>,
): UserLevel {
  const session = sessions.get(graph.topicId);
  if (!session) {
    return {
      level: "beginner",
      knownConceptIds: [],
      depthProfile: depthProfileForLevel("beginner"),
    };
  }
  for (const [qid, ans] of Object.entries(answers)) session.answers.set(qid, ans);
  return finalizeAssessment(graph);
}

/** Convenience: score + apply in one call (graph + knownBaseline + level). */
export function scoreAndApply(graph: KnowledgeGraph) {
  const userLevel = finalizeAssessment(graph);
  const { graph: appliedGraph, knownBaseline } = applyUserLevel(graph, userLevel);
  return { userLevel, graph: appliedGraph, knownBaseline };
}
