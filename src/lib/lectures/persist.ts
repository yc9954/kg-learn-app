/**
 * DB persistence for the lecture generator (PRD §5, AC-10/12). Persisting each
 * lecture makes "next" cheap to resume per user, and tracking per-user progress
 * keeps each learner's path isolated.
 *
 * Domain ↔ DB mapping (mirrors research/persist.ts + assessment/persist.ts):
 *   - ontology Concept.id == DB Concept.conceptKey (unique per topic).
 *   - DB Lecture.conceptId references the Concept ROW id, so we resolve
 *     conceptKey → row id before writing.
 *   - UserProgress.completed stores the ordered list of TAUGHT concept keys
 *     (the "already taught" set the generator consumes); currentNodeId holds the
 *     concept key of the lecture currently in front of the learner.
 */

import "server-only";
import { prisma } from "@/lib/db";
import type { Lecture } from "@/lib/ontology/types";

/** Resolve an ontology concept key → its Concept row id within a topic. */
async function conceptRowId(
  topicId: string,
  conceptKey: string,
): Promise<string | null> {
  const row = await prisma.concept.findUnique({
    where: { topicId_conceptKey: { topicId, conceptKey } },
    select: { id: true },
  });
  return row?.id ?? null;
}

/** Persist (idempotent upsert) a generated lecture for a topic. */
export async function saveLecture(
  topicId: string,
  lecture: Lecture,
): Promise<void> {
  const rowId = await conceptRowId(topicId, lecture.conceptId);
  if (!rowId) return; // concept not persisted yet — skip silently
  await prisma.lecture.upsert({
    where: { topicId_conceptId: { topicId, conceptId: rowId } },
    create: {
      topicId,
      conceptId: rowId,
      order: lecture.order,
      markdown: lecture.markdown,
    },
    update: { order: lecture.order, markdown: lecture.markdown },
  });
}

/** Load a previously-generated lecture for a concept, or null. */
export async function loadLecture(
  topicId: string,
  conceptKey: string,
): Promise<Lecture | null> {
  const rowId = await conceptRowId(topicId, conceptKey);
  if (!rowId) return null;
  const row = await prisma.lecture.findUnique({
    where: { topicId_conceptId: { topicId, conceptId: rowId } },
    select: { order: true, markdown: true },
  });
  if (!row) return null;
  return {
    id: `lec-${row.order}-${conceptKey}`,
    conceptId: conceptKey,
    order: row.order,
    markdown: row.markdown,
  };
}

export type Progress = {
  completedConceptKeys: string[];
  currentNodeId: string | null;
};

/** Load per-user progress for a topic (defaults to empty/none). */
export async function loadProgress(
  userId: string,
  topicId: string,
): Promise<Progress> {
  const row = await prisma.userProgress.findUnique({
    where: { userId_topicId: { userId, topicId } },
    select: { completed: true, currentNodeId: true },
  });
  const completed = Array.isArray(row?.completed)
    ? (row!.completed as unknown[]).map(String)
    : [];
  return { completedConceptKeys: completed, currentNodeId: row?.currentNodeId ?? null };
}

/** Upsert per-user progress (completed set + current concept). */
export async function saveProgress(
  userId: string,
  topicId: string,
  progress: Progress,
): Promise<void> {
  await prisma.userProgress.upsert({
    where: { userId_topicId: { userId, topicId } },
    create: {
      userId,
      topicId,
      completed: progress.completedConceptKeys,
      currentNodeId: progress.currentNodeId,
    },
    update: {
      completed: progress.completedConceptKeys,
      currentNodeId: progress.currentNodeId,
    },
  });
}

/**
 * Mark the concept currently in front of the learner complete, and set the next
 * concept as current. Idempotent: completing the same concept twice is a no-op
 * on the completed set.
 */
export async function advanceProgress(
  userId: string,
  topicId: string,
  completedConceptKey: string | null,
  nextConceptKey: string | null,
): Promise<Progress> {
  const current = await loadProgress(userId, topicId);
  const completed = new Set(current.completedConceptKeys);
  if (completedConceptKey) completed.add(completedConceptKey);
  const next: Progress = {
    completedConceptKeys: [...completed],
    currentNodeId: nextConceptKey,
  };
  await saveProgress(userId, topicId, next);
  return next;
}
