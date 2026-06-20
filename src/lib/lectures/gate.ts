/**
 * Forward-reference-0 GATE (PRD §6 keystone; AC-9). This is the rule that
 * defines product success: a generated lecture may reference ONLY concepts the
 * learner has already been taught or already knows. The gate enforces it
 * structurally — a lecture that names an un-taught concept NEVER reaches the
 * user.
 *
 * Enforcement strategy:
 *   1. Generate the lecture markdown.
 *   2. Run `findForwardReferences(lecture, allowed, graph)` (the shared guard).
 *   3. If offenders exist, REGENERATE with the offender NAMES reinforced into
 *      the forbidden list, up to MAX_ATTEMPTS.
 *   4. If still failing, BLOCK: throw `ForwardReferenceError`. We never relax
 *      the rule to "mostly"; the caller must not surface a failed lecture.
 *
 * Note on "auto-insert the prerequisite earlier": a genuine prerequisite of the
 * concept is already taught before it (topoSort guarantees prerequisites precede
 * dependents, and known prerequisites are in the baseline). So any offender is a
 * NON-prerequisite the prose drifted into naming — the correct fix is to
 * re-generate without it, which is exactly what the loop does.
 */

import { findForwardReferences } from "@/lib/ontology/invariants";
import type { Lecture } from "@/lib/ontology/types";
import {
  generateLectureMarkdown,
  type GenerateFn,
  type LectureContext,
} from "./generate";

/** Default number of generation attempts before the gate blocks a lecture. */
export const MAX_ATTEMPTS = 4;

/** Thrown when forward-reference 0 cannot be achieved — the lecture is blocked. */
export class ForwardReferenceError extends Error {
  constructor(
    readonly conceptId: string,
    readonly offenders: string[],
    readonly attempts: number,
  ) {
    super(
      `Forward-reference gate blocked lecture for "${conceptId}" after ` +
        `${attempts} attempt(s); unresolved offenders: ${offenders.join(", ")}`,
    );
    this.name = "ForwardReferenceError";
  }
}

export type GateResult = {
  lecture: Lecture;
  /** How many generation attempts the gate needed (1 = clean first try). */
  attempts: number;
};

/** Map offender concept IDs → their human names (for the forbidden reinforce). */
function offenderNames(ctx: LectureContext, offenderIds: string[]): string[] {
  const byId = new Map(ctx.graph.nodes.map((n) => [n.id, n.name] as const));
  return offenderIds.map((id) => byId.get(id) ?? id);
}

/**
 * Generate a lecture for `ctx.concept` and GATE it on forward-reference 0.
 * Returns a clean `Lecture` (offenders = []), or throws `ForwardReferenceError`
 * if it cannot be made clean within `maxAttempts`. The returned lecture is
 * GUARANTEED to pass `findForwardReferences(... ) === []`.
 */
export async function generateGatedLecture(
  ctx: LectureContext,
  generate: GenerateFn,
  maxAttempts: number = MAX_ATTEMPTS,
): Promise<GateResult> {
  const lectureId = `lec-${ctx.order}-${ctx.concept.id}`;
  let reinforcedForbidden: string[] = [];
  let lastOffenders: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const markdown = await generateLectureMarkdown(
      ctx,
      generate,
      reinforcedForbidden,
    );

    const lecture: Lecture = {
      id: lectureId,
      conceptId: ctx.concept.id,
      order: ctx.order,
      markdown,
    };

    const offenders = findForwardReferences(
      lecture,
      ctx.allowedConceptIds,
      ctx.graph,
    );

    if (offenders.length === 0) {
      return { lecture, attempts: attempt };
    }

    // Reinforce: forbid the offenders by NAME on the next attempt (accumulate).
    lastOffenders = offenders;
    reinforcedForbidden = Array.from(
      new Set([...reinforcedForbidden, ...offenderNames(ctx, offenders)]),
    );
  }

  // Never surface a lecture that fails the keystone rule.
  throw new ForwardReferenceError(ctx.concept.id, lastOffenders, maxAttempts);
}
