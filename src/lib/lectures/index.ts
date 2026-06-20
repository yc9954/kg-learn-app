/**
 * Lecture generator — public surface (PRD §8 step 5; AC-9/10/11).
 *
 * Ties together the three pieces of the keystone pipeline:
 *   - path.ts     → pruned topological learning path (known concepts removed).
 *   - generate.ts → write ONE lecture at a time via the Copilot SDK (quality).
 *   - gate.ts     → enforce forward-reference 0; never surface a failed lecture.
 *
 * Re-exports the shared guards so importers go through this module, but never
 * forks them (PRD §7).
 */

import { findForwardReferences, topoSort } from "@/lib/ontology/invariants";
import type {
  KnowledgeGraph,
  Lecture,
  UserLevel,
} from "@/lib/ontology/types";
import { CopilotProvider } from "@/lib/ai/copilot";
import {
  allowedConceptIdsFor,
  buildLearningPath,
  nextConceptId,
} from "./path";
import { generateGatedLecture, type GateResult } from "./gate";
import type { GenerateFn, LectureContext } from "./generate";

export { findForwardReferences, topoSort };
export {
  buildLearningPath,
  knownBaselineIds,
  nextConceptId,
  allowedConceptIdsFor,
} from "./path";
export {
  generateGatedLecture,
  ForwardReferenceError,
  MAX_ATTEMPTS,
} from "./gate";
export {
  buildLecturePrompt,
  generateLectureMarkdown,
  type GenerateFn,
  type LectureContext,
} from "./generate";

const defaultGenerate: GenerateFn = (prompt, opts) =>
  CopilotProvider.generate(prompt, opts);

/** The result of asking for the next lecture in a learner's path. */
export type NextLectureResult = {
  /** The gated, forward-ref-0-clean lecture, or null when the path is done. */
  lecture: Lecture | null;
  /** True when there are no more concepts to teach. */
  done: boolean;
  /** Generation attempts the gate needed (undefined when done). */
  attempts?: number;
};

/**
 * Generate the NEXT forward-ref-0 lecture for a learner.
 *
 * @param graph  the (assessment-applied) knowledge graph — `known` flags set.
 * @param level  the learner's `UserLevel` (drives depth via depthProfile).
 * @param alreadyTaughtConceptIds  concepts already delivered this session.
 * @returns the next gated lecture (or done=true when the path is complete).
 *
 * The returned lecture is GUARANTEED to satisfy forward-reference 0 — the gate
 * either produces a clean lecture or throws (and we surface nothing). Lectures
 * are produced ONE AT A TIME in topological order, each building on the prior
 * ones (their concepts join the allow-list).
 */
export async function generateNextLecture(
  graph: KnowledgeGraph,
  level: UserLevel,
  alreadyTaughtConceptIds: string[] = [],
  generate: GenerateFn = defaultGenerate,
): Promise<NextLectureResult> {
  const conceptId = nextConceptId(graph, alreadyTaughtConceptIds);
  if (!conceptId) return { lecture: null, done: true };

  const concept = graph.nodes.find((n) => n.id === conceptId);
  if (!concept) return { lecture: null, done: true };

  // Order = the concept's position within the pruned learning path.
  const path = buildLearningPath(graph);
  const order = path.indexOf(conceptId);

  const ctx: LectureContext = {
    concept,
    graph,
    depthProfile: level.depthProfile,
    allowedConceptIds: allowedConceptIdsFor(
      graph,
      conceptId,
      alreadyTaughtConceptIds,
    ),
    order: order >= 0 ? order : alreadyTaughtConceptIds.length,
  };

  const { lecture, attempts }: GateResult = await generateGatedLecture(
    ctx,
    generate,
  );
  return { lecture, done: false, attempts };
}
