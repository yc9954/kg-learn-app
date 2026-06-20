/**
 * DB persistence for the level assessor (PRD §5, AC-5/12). Stores the final
 * `UserLevel` per (user, topic) and flips the durable `known` flags on the
 * topic's concepts so `loadGraph` (and thus the lecture-generator's
 * forward-ref-0 baseline) sees the known-node set on the next read.
 *
 * Domain ↔ DB mapping mirrors research/persist.ts:
 *   - UserLevel.knownConceptIds are ontology Concept ids == Concept.conceptKey.
 */

import "server-only";
import { prisma } from "@/lib/db";
import type { UserLevel } from "@/lib/ontology/types";

/** Mark the given concepts as `known: true` on a topic (idempotent). */
export async function persistKnownFlags(
  topicId: string,
  knownConceptIds: string[],
): Promise<void> {
  if (knownConceptIds.length === 0) return;
  await prisma.concept.updateMany({
    where: { topicId, conceptKey: { in: knownConceptIds } },
    data: { known: true },
  });
}

/** Upsert the per-user assessment result (unique on [userId, topicId]). */
export async function saveAssessmentResult(
  userId: string,
  topicId: string,
  level: UserLevel,
  answers: unknown,
): Promise<void> {
  await prisma.assessmentResult.upsert({
    where: { userId_topicId: { userId, topicId } },
    create: {
      userId,
      topicId,
      level: level.level,
      knownConceptIds: level.knownConceptIds,
      depthProfile: level.depthProfile,
      answers: (answers ?? {}) as object,
    },
    update: {
      level: level.level,
      knownConceptIds: level.knownConceptIds,
      depthProfile: level.depthProfile,
      answers: (answers ?? {}) as object,
    },
  });
}

/** Load a persisted assessment result, or null if the user has not taken one. */
export async function loadAssessmentResult(
  userId: string,
  topicId: string,
): Promise<UserLevel | null> {
  const row = await prisma.assessmentResult.findUnique({
    where: { userId_topicId: { userId, topicId } },
    select: { level: true, knownConceptIds: true, depthProfile: true },
  });
  if (!row) return null;
  return {
    level: row.level as UserLevel["level"],
    knownConceptIds: (row.knownConceptIds as string[]) ?? [],
    depthProfile: row.depthProfile as UserLevel["depthProfile"],
  };
}
